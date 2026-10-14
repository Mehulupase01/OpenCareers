import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../packages/config/src/index.js";
import { AccountRepository } from "../../packages/persistence/src/account-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { EmailRepository } from "../../packages/persistence/src/email-repository.js";
import { connect } from "../../packages/persistence/src/index.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import {
  assertNoRestoreReplay,
  RestoreRepository,
} from "../../packages/persistence/src/restore-repository.js";
import { SourceSessionRepository } from "../../packages/persistence/src/source-session-repository.js";
import { VaultCipher } from "../../packages/security/src/vault.js";

const snapshot = "a".repeat(64);
const gapEvidence = () => ({
  externalHistoryReviewedAndImported: true as const,
  evidenceSha256: "c".repeat(64),
  from: "2020-01-01T00:00:00.000Z",
  through: new Date().toISOString(),
});
const job = {
  id: "job",
  employerId: "employer",
  requisitionId: "req",
  title: "Synthetic role",
  company: "Synthetic Co",
  location: "NL",
  url: "https://synthetic.example",
  description: "Synthetic fixture",
  source: "fixture",
  synthetic: true,
};

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} restore safety`,
    () => {
      let db: Database;
      let repo: Repository;
      let restores: RestoreRepository;
      let owner: string;
      let appId: string;
      let actor: string;
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `restore-${randomUUID()}`;
        actor = `owner:${owner}`;
        repo = new Repository(db, owner);
        restores = new RestoreRepository(db, owner);
        await repo.initialize();
        await repo.putJob(job);
        appId = (await repo.createApplication(job.id, "candidate")).id;
      });
      afterEach(async () => {
        await db.close();
      });

      it("revokes restored signup handles and locks even accounts without recorded attempts", async () => {
        const candidateId = randomUUID(),
          policyId = randomUUID();
        await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,$2)", [owner, candidateId]);
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,1,$3,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')",
          [policyId, owner, JSON.stringify({ allowAccountCreation: true })],
        );
        await db.query(
          "UPDATE candidates SET active_authorization_id=$1 WHERE owner_id=$2 AND id=$3",
          [policyId, owner, candidateId],
        );
        const accounts = new AccountRepository(db, owner, Buffer.alloc(32, 19).toString("base64"));
        const prepared = [];
        for (const name of ["intent", "dispatched", "unrecorded"])
          prepared.push(
            await accounts.prepare({
              candidateId,
              employerOrigin: `https://${name}.synthetic.example`,
              adapterId: "synthetic-signup",
              identityEmail: "candidate@example.test",
            }),
          );
        const [first, second, third] = prepared;
        if (!first || !second || !third) throw new Error("Expected three synthetic accounts");
        const intent = await accounts.beginSignup(first.id),
          dispatched = await accounts.beginSignup(second.id);
        await accounts.authorizeSignup(dispatched);
        const cipher = new VaultCipher(Buffer.alloc(32, 19).toString("base64"));
        for (const state of ["pending", "in_flight"]) {
          const secretId = randomUUID(),
            messageId = randomUUID(),
            linkId = randomUUID();
          const binding = {
            ownerId: owner,
            secretId,
            purpose: "email_verification" as const,
            keyVersion: 1,
          };
          await db.query(
            "INSERT INTO vault_secrets(owner_id,id,purpose,key_version,envelope,created_at) VALUES($1,$2,'email_verification',1,$3,$4)",
            [
              owner,
              secretId,
              JSON.stringify(cipher.seal(Buffer.from("synthetic-verification"), binding)),
              new Date().toISOString(),
            ],
          );
          await db.query(
            "INSERT INTO email_messages(owner_id,id,mailbox_hash,provider_message_id,sha256,classification,correlation,context_id,context_kind,received_at,created_at) VALUES($1,$2,'synthetic',$2,$3,'verification','correlated',$4,'account',$5,$5)",
            [owner, messageId, "c".repeat(64), second.id, new Date().toISOString()],
          );
          await db.query(
            "INSERT INTO email_verification_links(owner_id,id,message_id,account_id,secret_id,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              owner,
              linkId,
              messageId,
              second.id,
              secretId,
              state,
              new Date(Date.now() + 3600000).toISOString(),
            ],
          );
        }
        const run = await restores.block(snapshot);
        const links = await db.query(
          "SELECT state FROM email_verification_links WHERE owner_id=$1",
          [owner],
        );
        expect(links).toHaveLength(2);
        expect(links.every((link) => link.state === "unknown")).toBe(true);
        await expect(accounts.authorizeSignup(intent)).rejects.toMatchObject({
          code: "LEASE_STALE",
        });
        await expect(accounts.markSignupUnknown(dispatched)).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        await expect(accounts.beginSignup(third.id)).rejects.toMatchObject({
          code: "POLICY_REVOKED",
        });
        await expect(
          accounts.credential({
            accountId: third.id,
            employerOrigin: third.employerOrigin,
            adapterId: third.adapterId,
          }),
        ).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        expect((await accounts.snapshot()).every((account) => account.state === "locked")).toBe(
          true,
        );
        const attempts = await db.query(
          "SELECT state,fence FROM signup_attempts WHERE owner_id=$1 ORDER BY started_at,id",
          [owner],
        );
        expect(attempts).toHaveLength(2);
        expect(attempts.every((attempt) => attempt.state === "UNKNOWN")).toBe(true);
        await restores.review(
          run,
          appId,
          { disposition: "quarantined", note: "No replay after restore." },
          actor,
        );
        await restores.release(run, actor, gapEvidence());
        await expect(accounts.beginSignup(third.id)).rejects.toMatchObject({
          code: "DUPLICATE_SUSPECTED",
        });
        await expect(
          accounts.credential({
            accountId: third.id,
            employerOrigin: third.employerOrigin,
            adapterId: third.adapterId,
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });

      it("invalidates Gmail generations and source sessions across restore release without affecting another owner", async () => {
        const key = Buffer.alloc(32, 23).toString("base64");
        const mail = new EmailRepository(db, owner, key);
        const client = { clientId: "synthetic-client", clientSecret: "synthetic-client-secret" };
        await mail.configure(client, "candidate@example.test", true);
        await mail.connected(await mail.lease("connecting"), {
          accessToken: "synthetic-access-token",
          refreshToken: "synthetic-refresh-token",
          mailbox: "candidate@example.test",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          refreshExpiresAt: null,
        });
        const lease = await mail.lease("connected");
        const sessions = new SourceSessionRepository(db, owner, key);
        const input = {
          sourceId: "synthetic-board",
          adapterId: "synthetic-read-v1",
          expectedRevision: 0,
          ownedAccount: true as const,
          permissionEvidenceSha256: "a".repeat(64),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          session: {
            origin: "https://jobs.synthetic.example",
            cookies: [
              {
                name: "session",
                value: "synthetic-cookie",
                domain: "jobs.synthetic.example",
                path: "/",
                expires: -1,
                httpOnly: true,
                secure: true,
                sameSite: "Lax" as const,
              },
            ],
          },
        };
        await sessions.store(input);
        const foreign = new EmailRepository(db, `foreign-${owner}`, key);
        await foreign.initialize();
        await foreign.configure(client, "other@example.test", true);
        const beforeForeign = (await foreign.snapshot()).connection;
        const run = await restores.block(snapshot);
        await expect(mail.credentials(lease)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        expect((await mail.snapshot()).connection).toMatchObject({
          state: "reconnect_required",
          generation: lease.generation + 1,
        });
        expect((await sessions.snapshot())[0]).toMatchObject({ state: "revoked", revision: 2 });
        expect(await restores.block(snapshot)).toBe(run);
        expect((await mail.snapshot()).connection).toMatchObject({
          state: "reconnect_required",
          generation: lease.generation + 2,
        });
        await restores.review(
          run,
          appId,
          { disposition: "quarantined", note: "Restore fixture." },
          actor,
        );
        await restores.release(run, actor, gapEvidence());
        await repo.setControl({ stopped: false, discoveryPaused: false, preparationPaused: false });
        await expect(mail.credentials(lease)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
        await expect(mail.lease("connected")).rejects.toThrow();
        await expect(
          sessions.read({
            sourceId: input.sourceId,
            adapterId: input.adapterId,
            origin: input.session.origin,
            revision: 1,
            permissionEvidenceSha256: input.permissionEvidenceSha256,
          }),
        ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
        expect((await foreign.snapshot()).connection).toEqual(beforeForeign);
        const connection = (
          await db.query(
            "SELECT token_secret_id,lease_until,data FROM email_connections WHERE owner_id=$1",
            [owner],
          )
        )[0];
        if (!connection) throw new Error("Expected synthetic mailbox connection");
        expect(connection.token_secret_id).toBeNull();
        expect(connection.lease_until).toBeNull();
        expect(JSON.parse(String(connection.data))).toMatchObject({
          cursorSecretId: null,
          scanPaused: true,
        });
      });

      it("atomically pauses and revokes leases, refuses normal-control overrides and requires all reviews", async () => {
        await repo.enqueue({
          type: "prepare",
          domain: "owned",
          applicationId: appId,
          dedupeKey: "prepare",
        });
        const task = await repo.claim("old-worker", ["prepare"]);
        expect(task).not.toBeNull();
        if (!task) throw new Error("Expected synthetic preparation lease");
        const run = await restores.block(snapshot);
        expect(await restores.block(snapshot)).toBe(run);
        await expect(restores.block("b".repeat(64))).rejects.toThrow("already open");
        expect(await repo.getControl()).toMatchObject({
          restoreBlocked: true,
          discoveryPaused: true,
          preparationPaused: true,
          submissionsPaused: true,
        });
        await expect(repo.renew(task)).rejects.toMatchObject({ code: "LEASE_STALE" });
        await expect(repo.setControl({ restoreBlocked: false } as never)).rejects.toThrow();
        await repo.setControl({ stopped: false, submissionsPaused: false });
        expect((await repo.getControl()).restoreBlocked).toBe(true);
        await expect(restores.release(run, "system")).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
        await expect(restores.release(run, actor)).rejects.toThrow();
        await expect(restores.release(run, actor, gapEvidence())).rejects.toThrow(
          "Every restored application",
        );
        await expect(
          restores.review(
            run,
            appId,
            { disposition: "receipt", receiptId: randomUUID(), note: "Not an actual receipt" },
            actor,
          ),
        ).rejects.toThrow("correlated confirmed receipt");
        expect((await restores.status()).reviews[0]?.disposition).toBe("pending");
      });

      it("keeps restored applications permanently quarantined while allowing fresh applications after release", async () => {
        const run = await restores.block(snapshot);
        await restores.review(
          run,
          appId,
          { disposition: "quarantined", note: "Outcome cannot be proved. Never replay." },
          actor,
        );
        await expect(restores.release(run, actor)).rejects.toThrow();
        await expect(
          restores.release(run, actor, { ...gapEvidence(), through: "2020-01-02T00:00:00.000Z" }),
        ).rejects.toThrow("backup-to-restore gap");
        expect(await restores.release(run, actor, gapEvidence())).toMatchObject({
          restoreBlocked: false,
          submissionsPaused: true,
        });
        await repo.setControl({ submissionsPaused: false });
        await repo.enqueue({
          type: "submit",
          domain: "owned",
          applicationId: appId,
          dedupeKey: "replay",
        });
        expect(await repo.claim("worker", ["submit"])).toBeNull();
        await expect(assertNoRestoreReplay(db, owner, appId)).rejects.toMatchObject({
          code: "POLICY_REVOKED",
        });
        await repo.putJob({ ...job, id: "fresh-job", requisitionId: "fresh" });
        const fresh = await repo.createApplication("fresh-job", "candidate");
        await repo.enqueue({
          type: "submit",
          domain: "owned",
          applicationId: fresh.id,
          dedupeKey: "fresh",
        });
        expect((await repo.claim("worker", ["submit"]))?.applicationId).toBe(fresh.id);
        await expect(assertNoRestoreReplay(db, owner, fresh.id)).resolves.toBeUndefined();
      });

      it("preserves uncertain dispatches as read-only reconciliation with the original adapter and payload", async () => {
        const at = new Date().toISOString();
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES('policy',$1,1,'{}',$2,'2027-01-01T00:00:00.000Z')",
          [owner, at],
        );
        await db.query(
          "INSERT INTO packets(id,owner_id,application_id,manifest,sha256,created_at) VALUES('packet',$1,$2,'{}','synthetic',$3)",
          [owner, appId, at],
        );
        await db.query(
          "INSERT INTO intents(id,owner_id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES('intent',$1,$2,'packet','policy','{}','synthetic',$3)",
          [owner, appId, at],
        );
        await repo.setControl({ submissionsPaused: false });
        const payload = {
          schemaVersion: 1 as const,
          packetId: "packet",
          preparationId: "preparation",
          expectedRevision: 1,
        };
        await repo.enqueue({
          type: "submit",
          domain: "mock-ats",
          applicationId: appId,
          dedupeKey: "submit",
          payload,
        });
        const task = await repo.claim("old-worker", ["submit"]);
        if (!task) throw new Error("Expected synthetic submit lease");
        await db.query("UPDATE applications SET state='IN_FLIGHT' WHERE owner_id=$1 AND id=$2", [
          owner,
          appId,
        ]);
        await db.query(
          "INSERT INTO attempts(id,owner_id,application_id,intent_id,fence,state,started_at,dispatch_started_at) VALUES('attempt',$1,$2,'intent',$3,'IN_FLIGHT',$4,$4)",
          [owner, appId, task.fence, at],
        );
        await restores.block(snapshot);
        expect(
          (await db.query("SELECT state FROM attempts WHERE owner_id=$1", [owner]))[0]?.state,
        ).toBe("UNKNOWN");
        expect(
          (
            await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
              owner,
              appId,
            ])
          )[0]?.state,
        ).toBe("UNKNOWN");
        expect(await repo.claim("new-worker", ["submit"])).toBeNull();
        const reconciliation = await repo.claim("new-worker", ["reconcile"]);
        expect(reconciliation).toMatchObject({
          type: "reconcile",
          domain: "mock-ats",
          applicationId: appId,
          payload,
        });
        expect(
          (await db.query("SELECT reason FROM packet_validity WHERE owner_id=$1", [owner]))[0]
            ?.reason,
        ).toBe("restore quarantine");
      });

      it("validates receipt integrity and tenant correlation before settling a review", async () => {
        const run = await restores.block(snapshot);
        const at = new Date().toISOString();
        const receiptId = randomUUID();
        const evidence = {
          kind: "mock_ats",
          recordId: randomUUID(),
          jobId: job.id,
          receiptUrl: "http://127.0.0.1/owned-receipt",
          receivedAt: at,
          emailHash: "0".repeat(64),
        };
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES('policy',$1,1,'{}',$2,'2027-01-01T00:00:00.000Z')",
          [owner, at],
        );
        await db.query(
          "INSERT INTO packets(id,owner_id,application_id,manifest,sha256,created_at) VALUES('packet',$1,$2,'{}','synthetic',$3)",
          [owner, appId, at],
        );
        await db.query(
          "INSERT INTO intents(id,owner_id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES('intent',$1,$2,'packet','policy','{}','synthetic',$3)",
          [owner, appId, at],
        );
        await db.query(
          "INSERT INTO attempts(id,owner_id,application_id,intent_id,fence,state,started_at) VALUES('attempt',$1,$2,'intent',1,'CONFIRMED',$3)",
          [owner, appId, at],
        );
        await db.query("UPDATE applications SET state='CONFIRMED' WHERE owner_id=$1 AND id=$2", [
          owner,
          appId,
        ]);
        await db.query(
          "INSERT INTO receipts(id,owner_id,application_id,attempt_id,evidence,sha256,observed_at) VALUES($1,$2,$3,'attempt',$4,$5,$6)",
          [
            receiptId,
            owner,
            appId,
            JSON.stringify(evidence),
            createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
            at,
          ],
        );
        await restores.review(
          run,
          appId,
          { disposition: "receipt", receiptId, note: "Correlated stored confirmation." },
          actor,
        );
        await expect(assertNoRestoreReplay(db, owner, appId)).rejects.toThrow();
        await db.query("UPDATE receipts SET sha256=$1 WHERE owner_id=$2 AND id=$3", [
          "f".repeat(64),
          owner,
          receiptId,
        ]);
        await expect(restores.release(run, actor, gapEvidence())).rejects.toThrow(
          "checksum is invalid",
        );
        await db.query("UPDATE receipts SET sha256=$1 WHERE owner_id=$2 AND id=$3", [
          createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
          owner,
          receiptId,
        ]);
        await restores.release(run, actor, gapEvidence());
        await expect(assertNoRestoreReplay(db, owner, appId)).resolves.toBeUndefined();
        await expect(
          restores.review(run, appId, { disposition: "quarantined", note: "Weaken" }, actor),
        ).rejects.toThrow("cannot be weakened");
        const foreign = new RestoreRepository(db, `foreign-${randomUUID()}`);
        await foreign.initialize();
        expect((await foreign.status()).runs).toEqual([]);
        await expect(
          foreign.review(
            run,
            appId,
            { disposition: "receipt", receiptId, note: "Cross-owner" },
            `owner:${foreign.ownerId}`,
          ),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    },
  );
}

it("blocks an actual offline SQLite snapshot and survives another process restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencareers-restore-drill-"));
  let db: Database | undefined;
  try {
    const original = join(dir, "original.sqlite");
    const copied = join(dir, "restored.sqlite");
    db = await openSqlite(original);
    await migrate(db);
    const repo = new Repository(db, "synthetic-owner");
    await repo.initialize();
    await repo.putJob(job);
    const app = await repo.createApplication(job.id, "candidate");
    await db.close();
    db = undefined;
    await copyFile(original, copied);
    const checksum = createHash("sha256")
      .update(await readFile(copied))
      .digest("hex");
    db = await openSqlite(copied);
    await new RestoreRepository(db, "synthetic-owner").block(checksum);
    await db.close();
    db = undefined;
    db = await openSqlite(copied);
    expect((await new Repository(db, "synthetic-owner").getControl()).restoreBlocked).toBe(true);
    await expect(assertNoRestoreReplay(db, "synthetic-owner", app.id)).rejects.toThrow();
  } finally {
    await db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("persists the startup restore marker before returning an operational connection", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-startup-barrier-")));
  const config = {
    ...loadConfig({}),
    profile: "local" as const,
    dataDir: dir,
    restoreSnapshotSha256: snapshot,
  };
  let repo: Repository | undefined;
  try {
    repo = await connect(config);
    expect((await repo.getControl()).restoreBlocked).toBe(true);
    await repo.db.close();
    repo = undefined;
    repo = await connect(config);
    expect((await repo.getControl()).restoreBlocked).toBe(true);
    expect((await new RestoreRepository(repo.db, repo.ownerId).status()).runs).toHaveLength(1);
  } finally {
    await repo?.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
