import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { factSchema } from "../../packages/contracts/src/candidate.js";
import type { MailMessage } from "../../packages/contracts/src/email.js";
import { mailHash } from "../../packages/email/src/correlation.js";
import {
  type VerificationRead,
  verificationRuleHash,
} from "../../packages/email/src/verification.js";
import { AccountRepository } from "../../packages/persistence/src/account-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { VerificationRepository } from "../../packages/persistence/src/verification-repository.js";

const key = Buffer.alloc(32, 29).toString("base64");
const now = new Date("2026-10-10T12:00:00.000Z");
const rule = {
  employerOrigin: "https://careers.synthetic.example",
  pathname: "/verify",
  queryKeys: ["token" as const],
  successMarker: "Your email address is verified.",
};

class FixtureVerification extends VerificationRepository {
  async seedLink(accountId: string, signupAttemptId: string) {
    const id = randomUUID();
    const messageId = randomUUID();
    const messageSha256 = mailHash(messageId);
    await this.db.transaction(async (tx) => {
      const secretId = await this.seal(tx, "email_verification", {
        url: `${rule.employerOrigin}/verify?token=synthetic-token-${id}`,
        accountId,
        signupAttemptId,
        identityEmailHash: mailHash("candidate@example.test"),
        messageSha256,
        ruleHash: verificationRuleHash(rule),
      });
      await tx.query(
        "INSERT INTO email_messages(owner_id,id,mailbox_hash,provider_message_id,sha256,classification,correlation,context_id,context_kind,received_at,created_at) VALUES($1,$2,$3,$2,$4,'verification','correlated',$5,'account',$6,$6)",
        [
          this.ownerId,
          messageId,
          mailHash("candidate@example.test"),
          messageSha256,
          accountId,
          now.toISOString(),
        ],
      );
      await tx.query(
        "INSERT INTO email_verification_links(owner_id,id,message_id,account_id,secret_id,state,expires_at) VALUES($1,$2,$3,$4,$5,'pending',$6)",
        [this.ownerId, id, messageId, accountId, secretId, "2026-10-10T13:00:00.000Z"],
      );
    });
    return id;
  }
}

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} verification dispatch authority`,
    () => {
      let db: Database;
      let dir: string;
      let owner: string;
      let accountId: string;
      let attemptId: string;
      let policyId: string;
      let repository: FixtureVerification;
      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-verification-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "fixture.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `verification-${randomUUID()}`;
        await new Repository(db, owner).initialize();
        const candidateId = randomUUID();
        policyId = randomUUID();
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,1,$3,$4,$5)",
          [
            policyId,
            owner,
            JSON.stringify({ allowAccountCreation: true }),
            "2020-01-01T00:00:00.000Z",
            "2099-01-01T00:00:00.000Z",
          ],
        );
        await db.query(
          "INSERT INTO candidates(owner_id,id,active_authorization_id) VALUES($1,$2,$3)",
          [owner, candidateId, policyId],
        );
        const profileId = randomUUID();
        const fact = factSchema.parse({
          id: randomUUID(),
          key: "identity",
          revision: 1,
          status: "owner_asserted",
          recordedAt: now.toISOString(),
          reviewedAt: now.toISOString(),
          expiresOn: null,
          value: {
            kind: "identity",
            fullName: "Alex Example",
            email: "candidate@example.test",
            phone: "",
            links: [],
          },
          provenance: { kind: "owner", statement: "Synthetic verification fixture." },
        });
        await db.query(
          "INSERT INTO profile_versions(id,owner_id,candidate_id,revision,data,created_at) VALUES($1,$2,$3,1,$4,$5)",
          [profileId, owner, candidateId, JSON.stringify({ facts: [fact] }), now.toISOString()],
        );
        await db.query("UPDATE candidates SET active_profile_id=$1 WHERE owner_id=$2", [
          profileId,
          owner,
        ]);
        const accounts = new AccountRepository(db, owner, key, () => now);
        const account = await accounts.prepare({
          candidateId,
          employerOrigin: rule.employerOrigin,
          adapterId: "synthetic-signup",
          identityEmail: "candidate@example.test",
        });
        accountId = account.id;
        const handle = await accounts.beginSignup(accountId);
        await accounts.authorizeSignup(handle);
        await accounts.markSignupUnknown(handle);
        attemptId = handle.attemptId;
        repository = new FixtureVerification(db, owner, key, () => now);
        await repository.approveRule(rule);
      });
      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });
      const link = () => repository.seedLink(accountId, attemptId);
      it("rotates beyond fifty contexts without omitting them from correlation", async () => {
        const accounts = new AccountRepository(db, owner, key, () => now);
        const candidate = (
          await db.query("SELECT id FROM candidates WHERE owner_id=$1", [owner])
        )[0];
        for (let index = 0; index < 51; index++) {
          const account = await accounts.prepare({
            candidateId: String(candidate?.id),
            employerOrigin: `https://careers-${index}.synthetic.example`,
            adapterId: "synthetic-signup",
            identityEmail: "candidate@example.test",
          });
          const handle = await accounts.beginSignup(account.id);
          await accounts.authorizeSignup(handle);
          await accounts.markSignupUnknown(handle);
        }
        await repository.configure(
          { clientId: "synthetic-google-client", clientSecret: "synthetic-google-secret" },
          "candidate@example.test",
          true,
        );
        await repository.connected(await repository.lease("connecting"), {
          accessToken: "synthetic-access-token",
          refreshToken: "synthetic-refresh-token",
          expiresAt: "2026-10-10T13:00:00.000Z",
          refreshExpiresAt: null,
          mailbox: "candidate@example.test",
        });
        const lease = await repository.lease("connected");
        expect(await repository.contexts()).toHaveLength(52);
        const first = await repository.scanPlan(lease);
        expect(first.contexts).toHaveLength(50);
        first.scan.entries.forEach((entry) => {
          entry.done = true;
        });
        await repository.saveScan(lease, first.scan);
        await repository.finishSync(lease);
        const next = await repository.lease("connected");
        const second = await repository.scanPlan(next);
        expect(second.contexts).toHaveLength(2);
        expect(
          new Set([...first.contexts, ...second.contexts].map((context) => context.id)).size,
        ).toBe(52);
        expect(second.totalContexts).toBe(52);
        await repository.finishSync(next, false);
      });
      const success: VerificationRead = async () => ({
        status: 200,
        location: null,
        body: rule.successMarker,
      });
      it("captures a correlated signup link once, keeps tokens encrypted, and deduplicates delivery", async () => {
        await repository.configure(
          { clientId: "synthetic-google-client", clientSecret: "synthetic-google-secret" },
          "candidate@example.test",
          true,
        );
        await repository.connected(await repository.lease("connecting"), {
          accessToken: "synthetic-access-token",
          refreshToken: "synthetic-refresh-token",
          expiresAt: "2026-10-10T13:00:00.000Z",
          refreshExpiresAt: null,
          mailbox: "candidate@example.test",
        });
        const lease = await repository.lease("connected");
        const message: MailMessage = {
          id: "synthetic-verification-mail",
          receivedAt: now.toISOString(),
          sender: "accounts@careers.synthetic.example",
          recipients: ["candidate@example.test"],
          authenticatedDomain: "careers.synthetic.example",
          subject: "Verify your email",
          text: `Verify your email: ${rule.employerOrigin}/verify?token=synthetic-private-token-12345`,
        };
        expect(await repository.contexts()).toHaveLength(1);
        expect(await repository.ingest(lease, message)).toBeTruthy();
        await repository.ingest(lease, message);
        const snapshot = await repository.verificationSnapshot();
        expect(snapshot.links).toHaveLength(1);
        expect(
          await db.query("SELECT * FROM email_outcome_events WHERE owner_id=$1", [owner]),
        ).toHaveLength(1);
        const stored =
          JSON.stringify(
            await db.query("SELECT * FROM email_messages WHERE owner_id=$1", [owner]),
          ) +
          JSON.stringify(await db.query("SELECT * FROM vault_secrets WHERE owner_id=$1", [owner]));
        expect(stored).not.toContain("synthetic-private-token");
        expect(stored).not.toContain(message.subject);
        await repository.finishSync(lease);
        await repository.followLink(snapshot.links[0]?.id as string, success);
        expect((await repository.verificationSnapshot()).links[0]?.state).toBe("verified");
      });
      it("records intent before the request and confirms only reviewed success", async () => {
        const id = await link();
        await repository.followLink(id, async (url, signal) => {
          expect((await repository.verificationSnapshot()).links[0]?.state).toBe("in_flight");
          return success(url, signal);
        });
        expect((await repository.verificationSnapshot()).links[0]?.state).toBe("verified");
        expect(
          (
            await db.query("SELECT state FROM employer_accounts WHERE owner_id=$1 AND id=$2", [
              owner,
              accountId,
            ])
          )[0]?.state,
        ).toBe("active");
        expect(
          await db.query("SELECT * FROM email_verification_evidence WHERE owner_id=$1", [owner]),
        ).toHaveLength(1);
        expect(JSON.stringify(await repository.verificationSnapshot())).not.toContain(
          "synthetic-token",
        );
        await expect(repository.followLink(id, success)).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
      });
      it("checks each redirect and never requests an unreviewed origin", async () => {
        const id = await link();
        let calls = 0;
        await expect(
          repository.followLink(id, async () => {
            calls++;
            return { status: 302, location: "https://evil.synthetic.example/verify", body: "" };
          }),
        ).rejects.toMatchObject({ code: "COMMIT_UNKNOWN" });
        expect(calls).toBe(1);
        expect((await repository.verificationSnapshot()).links[0]?.state).toBe("unknown");
      });
      it("follows a separately reviewed same-origin success route", async () => {
        await repository.approveRule({ ...rule, pathname: "/verified", queryKeys: [] });
        let calls = 0;
        await repository.followLink(await link(), async () =>
          ++calls === 1
            ? { status: 303, location: "/verified", body: "" }
            : { status: 200, location: null, body: `<p>${rule.successMarker}</p>` },
        );
        expect(calls).toBe(2);
      });
      it("never replays uncertain requests, including a second token for that account", async () => {
        const id = await link();
        let calls = 0;
        const failed: VerificationRead = async () => {
          calls++;
          throw new Error("Synthetic lost response");
        };
        await expect(repository.followLink(id, failed)).rejects.toMatchObject({
          code: "COMMIT_UNKNOWN",
        });
        await expect(repository.followLink(id, failed)).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        await expect(repository.followLink(await link(), failed)).rejects.toMatchObject({
          code: "DUPLICATE_SUSPECTED",
        });
        expect(calls).toBe(1);
      });
      it("refuses dispatch after route approval removal", async () => {
        const id = await link();
        await repository.removeRule(rule.employerOrigin, rule.pathname);
        let calls = 0;
        await expect(
          repository.followLink(id, async (url, signal) => {
            calls++;
            return success(url, signal);
          }),
        ).rejects.toMatchObject({ code: "ORIGIN_DENIED" });
        expect(calls).toBe(0);
      });
      it("rechecks policy after the request before recording success", async () => {
        const id = await link();
        await expect(
          repository.followLink(id, async (url, signal) => {
            await db.query("UPDATE authorizations SET revoked_at=$1 WHERE owner_id=$2 AND id=$3", [
              now.toISOString(),
              owner,
              policyId,
            ]);
            return success(url, signal);
          }),
        ).rejects.toMatchObject({ code: "COMMIT_UNKNOWN" });
        expect(
          await db.query("SELECT * FROM email_verification_evidence WHERE owner_id=$1", [owner]),
        ).toHaveLength(0);
      });
      it("does not activate an account on HTTP 200 without exact evidence", async () => {
        await expect(
          repository.followLink(await link(), async () => ({
            status: 200,
            location: null,
            body: `Not successful: ${rule.successMarker}`,
          })),
        ).rejects.toMatchObject({ code: "COMMIT_UNKNOWN" });
        expect(
          (
            await db.query("SELECT state FROM employer_accounts WHERE owner_id=$1 AND id=$2", [
              owner,
              accountId,
            ])
          )[0]?.state,
        ).toBe("unknown");
      });
    },
  );
}
