import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";
import { VisibleHandoffBroker } from "../../packages/browser/src/handoff-broker.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { dryRunResultSchema } from "../../packages/contracts/src/browser.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { RestoreRepository } from "../../packages/persistence/src/restore-repository.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";
import { identity } from "../helpers/candidate-fixtures.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function setup(profile: "demo" | "local" = "demo") {
  const dataDir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-api-")));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const db = await openSqlite(":memory:");
  cleanup.push(() => db.close());
  await migrate(db);
  const repository = new Repository(db, "synthetic-owner");
  await repository.initialize();
  const app = await buildServer(
    {
      ...loadConfig({}),
      profile,
      dataDir,
      ownerToken: profile === "local" ? "a".repeat(32) : undefined,
    },
    repository,
  );
  cleanup.push(() => app.close());
  const headers = { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4318" };
  return { db, app, headers, repository };
}

describe("API trust boundary", () => {
  it("requires an owner session and exact request bodies for restore review and release", async () => {
    const { app, headers, db, repository } = await setup();
    const runId = await new RestoreRepository(db, repository.ownerId).block("a".repeat(64));
    expect((await app.inject({ url: "/v1/restores", headers })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/restores/${runId}/release`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    const authenticated = { ...headers, cookie: `opencareers=${login.cookies[0]?.value}` };
    const status = await app.inject({ url: "/v1/restores", headers: authenticated });
    expect(status.json().control.restoreBlocked).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/restores/${runId}/release`,
          headers: authenticated,
          payload: { force: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/restores/${runId}/release`,
          headers: authenticated,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/restores/${runId}/release`,
          headers: authenticated,
          payload: {
            externalHistoryReviewedAndImported: true,
            evidenceSha256: "c".repeat(64),
            from: "2020-01-01T00:00:00.000Z",
            through: new Date().toISOString(),
          },
        })
      ).statusCode,
    ).toBe(200);
    expect((await repository.getControl()).submissionsPaused).toBe(true);
  });
  it("protects candidate reads, writes and uploads and rejects oversized input", async () => {
    const { app, headers } = await setup();
    for (const url of [
      "/v1/candidate",
      "/v1/candidate/sources/unknown",
      "/v1/candidate/authorization/export",
      "/v1/handoffs",
    ])
      expect((await app.inject({ url, headers })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/v1/candidate/facts", headers, payload: identity }))
        .statusCode,
    ).toBe(401);
    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    const authenticated = { ...headers, cookie: `opencareers=${login.cookies[0]?.value}` };
    expect((await app.inject({ url: "/v1/handoffs", headers: authenticated })).json()).toEqual([]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/candidate/facts",
          headers: { ...authenticated, origin: "https://attacker.example" },
          payload: identity,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/candidate/facts",
          headers: authenticated,
          payload: { ...identity, unexpected: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/candidate/facts",
          headers: authenticated,
          payload: identity,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/browser/recruitee/prepare",
          headers: authenticated,
          payload: {
            packetId: "packet-not-configured",
            tenant: "synthetic",
            offerSlug: "software-engineer",
            approvedValues: {},
          },
        })
      ).statusCode,
    ).toBe(401);
    const payload = Buffer.concat([
      Buffer.from(
        '--synthetic-boundary\r\nContent-Disposition: form-data; name="file"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
      ),
      Buffer.alloc(10 * 1024 * 1024 + 1, 65),
      Buffer.from("\r\n--synthetic-boundary--\r\n"),
    ]);
    const oversized = await app.inject({
      method: "POST",
      url: "/v1/candidate/sources",
      headers: {
        ...authenticated,
        "content-type": "multipart/form-data; boundary=synthetic-boundary",
      },
      payload,
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().code).toBe("CONFIG_INVALID");
  });
  it("protects discovery configuration, URL recognition and history previews", async () => {
    const { app, headers } = await setup();
    expect((await app.inject({ url: "/v1/discovery", headers })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/matching", headers })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    const authenticated = { ...headers, cookie: `opencareers=${login.cookies[0]?.value}` };
    const matching = await app.inject({ url: "/v1/matching", headers: authenticated });
    expect(matching.statusCode).toBe(200);
    expect(matching.json()).toMatchObject({
      route: { status: "unconfigured", modelId: null, provider: null },
      budget: { limit: 40, used: 0, reserved: 0 },
      assessments: [],
    });
    expect(matching.body).not.toContain("API_KEY");
    const source = {
      expectedRevision: 0,
      connector: "greenhouse",
      board: "synthetic-api",
      region: "global",
      employerId: "synthetic-employer",
      company: "Synthetic Employer",
      intervalSeconds: 300,
      enabled: true,
      mode: "fixture",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/discovery/sources",
          headers: authenticated,
          payload: { ...source, mode: "live" },
        })
      ).statusCode,
    ).toBe(409);
    const created = await app.inject({
      method: "POST",
      url: "/v1/discovery/sources",
      headers: authenticated,
      payload: source,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ board: "synthetic-api", mode: "fixture" });
    const recognized = await app.inject({
      method: "POST",
      url: "/v1/discovery/recognize",
      headers: authenticated,
      payload: { url: "https://boards.greenhouse.io/synthetic-api/jobs/123?tracking=test" },
    });
    expect(recognized.json()).toMatchObject({
      board: "synthetic-api",
      postingId: "123",
      canonicalUrl: "https://job-boards.greenhouse.io/synthetic-api/jobs/123",
    });
    const record = {
      externalId: "synthetic-api-history",
      url: "https://boards.greenhouse.io/synthetic-api/jobs/123",
      company: "Synthetic Employer",
      title: "Software Engineer",
      location: "Amsterdam",
      submitted: false,
      submittedOn: null,
      ownerAssertion: "",
      documents: [{ name: "synthetic-letter.pdf", sha256: null }],
    };
    const preview = await app.inject({
      method: "POST",
      url: "/v1/discovery/history",
      headers: authenticated,
      payload: { format: "json", content: JSON.stringify([record]), preview: true },
    });
    expect(preview.json()).toMatchObject({ count: 1, records: [record] });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/discovery/sources",
          headers: { ...authenticated, origin: "https://attacker.example" },
          payload: source,
        })
      ).statusCode,
    ).toBe(403);
  });
  it("rejects foreign hosts, foreign origins and unauthenticated data requests", async () => {
    const { app, headers } = await setup();
    expect(
      (await app.inject({ url: "/health/live", headers: { host: "attacker.example" } })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/session",
          headers: { ...headers, origin: "https://attacker.example" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: "/v1/operations/summary", headers })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/session",
          headers: { host: headers.host },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it("creates a protected demo session, applies controls and invalidates sign-out", async () => {
    const { app, headers, db } = await setup();
    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    expect(login.statusCode).toBe(200);
    expect(login.cookies[0]).toMatchObject({ name: "opencareers", httpOnly: true });
    const cookie = `opencareers=${login.cookies[0]?.value}`;
    expect(
      (await app.inject({ url: "/v1/operations/summary", headers: { ...headers, cookie } })).json()
        .counts.confirmed,
    ).toBe(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/control/stop",
          headers: { ...headers, cookie },
        })
      ).json().stopped,
    ).toBe(true);
    expect(
      (await db.query("SELECT actor,revision FROM audit_events WHERE action='control.stopped'"))[0],
    ).toEqual({ actor: "owner:synthetic-owner", revision: 1 });
    await app.inject({ method: "DELETE", url: "/v1/session", headers: { ...headers, cookie } });
    expect(
      (await app.inject({ url: "/v1/operations/summary", headers: { ...headers, cookie } }))
        .statusCode,
    ).toBe(401);
  });
  it("permits repeated automatic demo sessions without exhausting private login limits", async () => {
    const { app, headers } = await setup();
    for (let index = 0; index < 12; index++) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/session",
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(200);
    }
  });
  it("limits failed private token checks from one address", async () => {
    const { app, headers } = await setup("local");
    for (let index = 0; index < 10; index++) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/session",
        headers,
        payload: { token: "invalid" },
      });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/session",
      headers,
      payload: { token: "invalid" },
    });
    expect(blocked.statusCode).toBe(429);
  });
  it("readiness fails when required persistence is unavailable", async () => {
    const { app, headers, db } = await setup();
    expect((await app.inject({ url: "/health/ready", headers })).statusCode).toBe(200);
    await db.query("DROP TABLE schema_migrations");
    expect((await app.inject({ url: "/health/ready", headers })).statusCode).toBe(503);
  });
  it("runs an authenticated challenge handoff without allowing a final action", async () => {
    const dataDir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-api-handoff-")));
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
    const db = await openSqlite(":memory:");
    cleanup.push(() => db.close());
    await migrate(db);
    const repository = new Repository(db, "synthetic-owner");
    await repository.initialize();
    const applicationId = randomUUID();
    const preparationId = randomUUID();
    const candidateId = randomUUID();
    const jobId = randomUUID();
    const base = documentGenerationInput();
    const input = {
      ...base,
      requestedAnswers: [],
      job: { ...base.job, id: jobId },
      profile: { ...base.profile, candidateId },
      authorization: {
        ...base.authorization,
        candidateId,
        effectiveAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      assessment: { ...base.assessment, applicationId, jobId },
    };
    const artifacts = new ArtifactStore(dataDir);
    await artifacts.initialize();
    const built = await buildPacket(artifacts, input);
    const packetId = built.manifest.id;
    const targetFingerprint = createHash("sha256")
      .update(JSON.stringify({ fixture: "challenge" }))
      .digest("hex");
    const snapshot = {
      url: "http://127.0.0.1:4320/jobs/challenge",
      origin: "http://127.0.0.1:4320",
      jobId: "synthetic-job",
      step: 1,
      fields: [],
      fingerprint: "a".repeat(64),
      blocker: "challenge" as const,
    };
    const result = dryRunResultSchema.parse({
      adapter: { id: "mock-ats", version: "mock-ats-v1", targetFingerprint },
      packetId,
      applicationId,
      status: "challenge",
      snapshots: [snapshot],
      plans: [{ fingerprint: snapshot.fingerprint, entries: [], unresolved: [] }],
      reports: [
        {
          snapshot,
          status: "challenge",
          readBack: [],
          uploadStatus: "idle",
          issues: ["Verification challenge requires owner action."],
        },
      ],
      issues: ["Verification challenge requires owner action."],
      blockedFinalActions: 0,
      serverApplicationCount: 0,
      preparedAt: "2026-09-28T20:00:00.000Z",
    });
    await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,$2)", [
      "synthetic-owner",
      candidateId,
    ]);
    await db.query(
      "INSERT INTO profile_versions(id,owner_id,candidate_id,revision,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        input.profile.id,
        "synthetic-owner",
        candidateId,
        input.profile.revision,
        JSON.stringify(input.profile),
        input.profile.createdAt,
      ],
    );
    await db.query(
      "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        input.authorization.id,
        "synthetic-owner",
        input.authorization.revision,
        JSON.stringify(input.authorization),
        input.authorization.effectiveAt,
        input.authorization.expiresAt,
      ],
    );
    await db.query(
      "UPDATE candidates SET active_profile_id=$1,active_authorization_id=$2 WHERE owner_id=$3",
      [input.profile.id, input.authorization.id, "synthetic-owner"],
    );
    await db.query(
      "INSERT INTO jobs(owner_id,id,employer_id,requisition_id,data,created_at,last_seen_at) VALUES($1,$2,'synthetic-employer','req','{}',$3,$3)",
      ["synthetic-owner", jobId, "2026-09-28T20:00:00.000Z"],
    );
    await db.query(
      "INSERT INTO applications(owner_id,id,candidate_id,job_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,'CHALLENGE_REQUIRED',$5,$5)",
      ["synthetic-owner", applicationId, candidateId, jobId, "2026-09-28T20:00:00.000Z"],
    );
    await db.query(
      "INSERT INTO packets(owner_id,id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        "synthetic-owner",
        packetId,
        applicationId,
        JSON.stringify(built.manifest),
        createHash("sha256").update(JSON.stringify(built.manifest)).digest("hex"),
        "2026-09-28T20:00:00.000Z",
      ],
    );
    await db.query(
      "INSERT INTO browser_preparations(owner_id,id,application_id,packet_id,status,form_fingerprint,result,created_at,expires_at) VALUES($1,$2,$3,$4,'challenge',$5,$6,$7,$8)",
      [
        "synthetic-owner",
        preparationId,
        applicationId,
        packetId,
        snapshot.fingerprint,
        JSON.stringify(result),
        "2026-09-28T20:00:00.000Z",
        "2099-09-28T20:15:00.000Z",
      ],
    );
    const broker = new VisibleHandoffBroker({
      visible: false,
      onOpened: async (page) => page.getByRole("button", { name: "Continue" }).click(),
    });
    const app = await buildServer(
      { ...loadConfig({}), dataDir, vaultKey: randomBytes(32).toString("base64") },
      repository,
      {
        handoffBroker: broker,
      },
    );
    cleanup.push(() => app.close());
    const headers = { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4318" };
    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    const authenticated = { ...headers, cookie: `opencareers=${login.cookies[0]?.value}` };
    const created = await app.inject({
      method: "POST",
      url: "/v1/handoffs",
      headers: authenticated,
      payload: {
        applicationId,
        preparationId,
        adapterId: "mock-ats",
        targetFingerprint,
      },
    });
    expect(created.statusCode).toBe(200);
    const handle = created.json() as { session: { id: string }; token: string };
    const opened = await app.inject({
      method: "POST",
      url: `/v1/handoffs/${handle.session.id}/open`,
      headers: authenticated,
      payload: { token: handle.token },
    });
    expect(opened.json()).toMatchObject({ state: "claimed", generation: 1 });
    const completed = await app.inject({
      method: "POST",
      url: `/v1/handoffs/${handle.session.id}/complete`,
      headers: authenticated,
      payload: { generation: 1 },
    });
    expect(completed.json()).toMatchObject({ state: "rebuilding", generation: 2 });
    expect(JSON.stringify(completed.json())).not.toContain("mock_owner_session");
    expect(
      await db.query("SELECT id FROM tasks WHERE owner_id=$1 AND type='inspect'", [
        "synthetic-owner",
      ]),
    ).toHaveLength(1);
    expect(
      await db.query("SELECT token_hash FROM handoff_sessions WHERE owner_id=$1 AND id=$2", [
        "synthetic-owner",
        handle.session.id,
      ]),
    ).not.toEqual([expect.objectContaining({ token_hash: handle.token })]);
  });
});
