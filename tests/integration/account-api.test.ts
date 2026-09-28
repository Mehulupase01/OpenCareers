import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { startMockAts } from "../../packages/mock-ats/src/server.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

const VAULT_KEY = Buffer.alloc(32, 23).toString("base64");
const IDENTITY_EMAIL = "candidate@example.test";
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

// `vaultKey: null` means "deliberately unconfigured", which is different from
// omitting the option.
async function setup(
  options: { externalSubmissionEnabled?: boolean; vaultKey?: string | null } = {},
) {
  const dataDir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-account-api-")));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const db = await openSqlite(":memory:");
  cleanup.push(() => db.close());
  await migrate(db);
  const owner = `account-api-${randomUUID()}`;
  const repository = new Repository(db, owner);
  await repository.initialize();

  const candidateId = randomUUID();
  const authorizationId = randomUUID();
  await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,$2)", [owner, candidateId]);
  await db.query(
    "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,1,$3,$4,$5)",
    [
      authorizationId,
      owner,
      JSON.stringify({ allowAccountCreation: true }),
      "2020-01-01T00:00:00.000Z",
      "2099-01-01T00:00:00.000Z",
    ],
  );
  await db.query("UPDATE candidates SET active_authorization_id=$1 WHERE owner_id=$2 AND id=$3", [
    authorizationId,
    owner,
    candidateId,
  ]);

  const mock = await startMockAts();
  cleanup.push(() => mock.app.close());

  const app = await buildServer(
    {
      ...loadConfig({}),
      profile: "local",
      dataDir,
      ownerToken: "a".repeat(32),
      vaultKey: options.vaultKey === undefined ? VAULT_KEY : (options.vaultKey ?? undefined),
      externalSubmissionEnabled: options.externalSubmissionEnabled ?? false,
    },
    repository,
    { signupRequest },
  );
  cleanup.push(() => app.close());

  const login = await app.inject({
    method: "POST",
    url: "/v1/session",
    headers: { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4318" },
    payload: { token: "a".repeat(32) },
  });
  const headers = {
    host: "127.0.0.1:4317",
    origin: "http://127.0.0.1:4318",
    cookie: `opencareers=${login.cookies[0]?.value}`,
  };
  return { app, db, headers, repository, mock, candidateId };
}

let signupFixture = "success";
const signupRequest = (input: string, init: RequestInit) =>
  fetch(`${input}?fixture=${signupFixture}`, init);

const prepare = (
  app: Awaited<ReturnType<typeof buildServer>>,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) => app.inject({ method: "POST", url: "/v1/accounts", headers, payload: body });

const signup = (
  app: Awaited<ReturnType<typeof buildServer>>,
  headers: Record<string, string>,
  id: string,
  identityEmail = IDENTITY_EMAIL,
) =>
  app.inject({
    method: "POST",
    url: `/v1/accounts/${id}/signup`,
    headers,
    payload: { identityEmail },
  });

const serverTruth = async (mock: Awaited<ReturnType<typeof startMockAts>>) =>
  (await mock.app.inject({ url: "/__test/records" })).json() as {
    signupCount: number;
  };

describe("employer account API", () => {
  it("requires owner authentication and never returns credential material", async () => {
    const { app, headers, mock, candidateId } = await setup();
    expect(
      (await app.inject({ url: "/v1/accounts", headers: { ...headers, cookie: "" } })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/accounts",
          headers: { ...headers, cookie: "" },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);

    const created = await prepare(app, headers, {
      candidateId,
      employerOrigin: mock.url,
      adapterId: "synthetic-signup",
      identityEmail: IDENTITY_EMAIL,
    });
    expect(created.statusCode).toBe(200);
    const list = (await app.inject({ url: "/v1/accounts", headers })).body;
    expect(list).not.toContain("password");
    expect(list).not.toContain(VAULT_KEY);
    expect(JSON.parse(list)).toEqual([
      expect.objectContaining({
        state: "prepared",
        hasCredential: true,
        employerOrigin: mock.url,
        adapterId: "synthetic-signup",
      }),
    ]);
  });

  it("creates a signed-in employer account through the one-action commit", async () => {
    const { app, headers, mock, candidateId } = await setup();
    const account = JSON.parse(
      (
        await prepare(app, headers, {
          candidateId,
          employerOrigin: mock.url,
          adapterId: "synthetic-signup",
          identityEmail: IDENTITY_EMAIL,
        })
      ).body,
    );
    const response = await signup(app, headers, account.id);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.account.state).toBe("active");
    expect(body.evidence).toMatchObject({
      employerOrigin: mock.url,
      adapterId: "synthetic-signup",
      verificationRequired: false,
    });
    expect(body.evidence.identityEmailHash).toBe(account.identityEmailHash);
    expect(response.body).not.toContain("password");
    expect((await serverTruth(mock)).signupCount).toBe(1);
  });

  it("records an account that the employer still gates behind email verification", async () => {
    const { app, headers, mock, candidateId } = await setup();
    signupFixture = "verification-required";
    try {
      const account = JSON.parse(
        (
          await prepare(app, headers, {
            candidateId,
            employerOrigin: mock.url,
            adapterId: "synthetic-signup",
            identityEmail: IDENTITY_EMAIL,
          })
        ).body,
      );
      const body = JSON.parse((await signup(app, headers, account.id)).body);
      expect(body.account.state).toBe("needs_verification");
      expect(body.evidence.verificationRequired).toBe(true);
    } finally {
      signupFixture = "success";
    }
  });

  it("refuses a repeat signup after a lost response even though the employer accepted it", async () => {
    const { app, headers, mock, candidateId } = await setup();
    const account = JSON.parse(
      (
        await prepare(app, headers, {
          candidateId,
          employerOrigin: mock.url,
          adapterId: "synthetic-signup",
          identityEmail: IDENTITY_EMAIL,
        })
      ).body,
    );
    signupFixture = "response-loss";
    try {
      const lost = await signup(app, headers, account.id);
      expect(lost.statusCode).toBe(409);
      expect(JSON.parse(lost.body).code).toBe("COMMIT_UNKNOWN");
      // The employer really did create the account; the local record says unknown.
      expect((await serverTruth(mock)).signupCount).toBe(1);
      expect(JSON.parse((await app.inject({ url: "/v1/accounts", headers })).body)[0].state).toBe(
        "unknown",
      );
      // A second attempt must not create a second account.
      const retry = await signup(app, headers, account.id);
      expect(JSON.parse(retry.body).code).toBe("DUPLICATE_SUSPECTED");
      expect((await serverTruth(mock)).signupCount).toBe(1);
    } finally {
      signupFixture = "success";
    }
  });

  it("distinguishes a definitive employer rejection from an unknown outcome", async () => {
    const { app, headers, mock, candidateId } = await setup();
    const account = JSON.parse(
      (
        await prepare(app, headers, {
          candidateId,
          employerOrigin: mock.url,
          adapterId: "synthetic-signup",
          identityEmail: IDENTITY_EMAIL,
        })
      ).body,
    );
    signupFixture = "validation-reject";
    try {
      const rejected = await signup(app, headers, account.id);
      expect(JSON.parse(rejected.body).code).toBe("STATE_INVALID");
      // The employer stored nothing, so this is genuinely a rejected attempt.
      expect((await serverTruth(mock)).signupCount).toBe(0);
      expect(JSON.parse((await app.inject({ url: "/v1/accounts", headers })).body)[0].state).toBe(
        "unknown",
      );
    } finally {
      signupFixture = "success";
    }
  });

  it("surfaces an employer duplicate as a second distinct local account, not a silent success", async () => {
    const { app, headers, mock, candidateId } = await setup();
    const first = JSON.parse(
      (
        await prepare(app, headers, {
          candidateId,
          employerOrigin: mock.url,
          adapterId: "synthetic-signup",
          identityEmail: IDENTITY_EMAIL,
        })
      ).body,
    );
    expect((await signup(app, headers, first.id)).statusCode).toBe(200);

    const second = JSON.parse(
      (
        await prepare(app, headers, {
          candidateId,
          employerOrigin: mock.url,
          adapterId: "synthetic-signup-2",
          identityEmail: IDENTITY_EMAIL,
        })
      ).body,
    );
    expect(second.id).not.toBe(first.id);
    signupFixture = "duplicate";
    try {
      const duplicate = await signup(app, headers, second.id);
      expect(JSON.parse(duplicate.body).code).toBe("STATE_INVALID");
      expect((await serverTruth(mock)).signupCount).toBe(1);
    } finally {
      signupFixture = "success";
    }
  });

  it("refuses a mismatched identity before taking a dispatch permit", async () => {
    const { app, headers, mock, candidateId, db } = await setup();
    const account = JSON.parse(
      (
        await prepare(app, headers, {
          candidateId,
          employerOrigin: mock.url,
          adapterId: "synthetic-signup",
          identityEmail: IDENTITY_EMAIL,
        })
      ).body,
    );
    const wrong = await signup(app, headers, account.id, "someone-else@example.test");
    expect(JSON.parse(wrong.body).code).toBe("RECEIPT_UNCORRELATED");
    expect((await serverTruth(mock)).signupCount).toBe(0);
    // No attempt was recorded, so the account is still safe to dispatch.
    expect(await db.query("SELECT id FROM signup_attempts")).toHaveLength(0);
  });

  it("blocks external account creation until the owner enables external submission", async () => {
    const { app, headers, candidateId } = await setup();
    const account = JSON.parse(
      (
        await prepare(app, headers, {
          candidateId,
          employerOrigin: "https://careers.synthetic.example",
          adapterId: "synthetic-signup",
          identityEmail: IDENTITY_EMAIL,
        })
      ).body,
    );
    const blocked = await signup(app, headers, account.id);
    expect(JSON.parse(blocked.body).code).toBe("CONFIG_INVALID");
  });

  it("refuses a non-exact employer origin before anything is stored", async () => {
    const { app, headers, candidateId } = await setup();
    for (const employerOrigin of [
      "https://careers.synthetic.example/jobs",
      "http://careers.synthetic.example",
      "https://user:pass@careers.synthetic.example",
    ]) {
      const response = await prepare(app, headers, {
        candidateId,
        employerOrigin,
        adapterId: "synthetic-signup",
        identityEmail: IDENTITY_EMAIL,
      });
      expect(JSON.parse(response.body).code).toBe("ORIGIN_DENIED");
    }
    expect(JSON.parse((await app.inject({ url: "/v1/accounts", headers })).body)).toHaveLength(0);
  });

  it("refuses signup when the standing policy does not allow account creation", async () => {
    const { app, headers, mock, candidateId, db, repository } = await setup();
    const account = JSON.parse(
      (
        await prepare(app, headers, {
          candidateId,
          employerOrigin: mock.url,
          adapterId: "synthetic-signup",
          identityEmail: IDENTITY_EMAIL,
        })
      ).body,
    );
    await db.query("UPDATE authorizations SET data=$1 WHERE owner_id=$2", [
      JSON.stringify({ allowAccountCreation: false }),
      repository.ownerId,
    ]);
    const refused = await signup(app, headers, account.id);
    expect(JSON.parse(refused.body).code).toBe("POLICY_REVOKED");
    expect((await serverTruth(mock)).signupCount).toBe(0);
  });

  it("boots without a vault key and fails every account route closed", async () => {
    const { app, headers } = await setup({ vaultKey: null });
    for (const response of [
      await app.inject({ url: "/v1/accounts", headers }),
      await prepare(app, headers, {
        candidateId: randomUUID(),
        employerOrigin: "http://127.0.0.1:9",
        adapterId: "synthetic-signup",
        identityEmail: IDENTITY_EMAIL,
      }),
      await signup(app, headers, randomUUID()),
    ]) {
      expect(JSON.parse(response.body).code).toBe("CONFIG_INVALID");
    }
    // The rest of the API is unaffected, which is the point of failing closed per
    // route rather than refusing to start.
    expect((await app.inject({ url: "/v1/operations/summary", headers })).statusCode).toBe(200);
  });
});
