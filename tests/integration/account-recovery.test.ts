import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountRepository } from "../../packages/persistence/src/account-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { RestoreRepository } from "../../packages/persistence/src/restore-repository.js";

const key = Buffer.alloc(32, 23).toString("base64"),
  password = "synthetic-replacement-password";
for (const engine of ["sqlite", "postgres"] as const)
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} reviewed account recovery`,
    () => {
      let db: Database, repo: Repository, accounts: AccountRepository, recovery: RestoreRepository;
      let owner: string, now: Date, accountId: string, runId: string, candidateId: string;
      const origin = "https://careers.synthetic.example",
        adapterId = "synthetic-signup",
        identityEmail = "candidate@example.test";
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `account-recovery-${randomUUID()}`;
        now = new Date("2026-10-14T12:00:00.000Z");
        repo = new Repository(db, owner, () => now);
        await repo.initialize();
        accounts = new AccountRepository(db, owner, key, () => now);
        recovery = new RestoreRepository(db, owner, () => now);
        candidateId = randomUUID();
        const policy = randomUUID();
        await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,$2)", [owner, candidateId]);
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,1,$3,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')",
          [policy, owner, JSON.stringify({ allowAccountCreation: true })],
        );
        await db.query(
          "UPDATE candidates SET active_authorization_id=$1 WHERE owner_id=$2 AND id=$3",
          [policy, owner, candidateId],
        );
        accountId = (
          await accounts.prepare({ candidateId, employerOrigin: origin, adapterId, identityEmail })
        ).id;
        const handle = await accounts.beginSignup(accountId);
        await accounts.authorizeSignup(handle);
        now = new Date("2026-10-14T12:01:00.000Z");
        await repo.setControl({ stopped: true });
        runId = await recovery.block("a".repeat(64), "system:restore", "2020-01-01T00:00:00.000Z");
        now = new Date("2026-10-14T12:02:00.000Z");
      });
      afterEach(async () => {
        await db.close();
      });
      const input = () => ({
        disposition: "verified_existing" as const,
        expectedUpdatedAt: "2026-10-14T12:01:00.000Z",
        reviewedAt: now.toISOString(),
        evidenceSha256: "b".repeat(64),
        employerOrigin: origin,
        adapterId,
        identityEmail,
        replacementPassword: password,
        existingAccountAndReplacementCredentialVerified: true as const,
      });
      const release = () =>
        recovery.release(runId, `owner:${owner}`, {
          externalHistoryReviewedAndImported: true,
          evidenceSha256: "c".repeat(64),
          from: "2020-01-01T00:00:00.000Z",
          through: now.toISOString(),
        });

      it("requires owner scope and complete global restore review before restoring account access", async () => {
        await expect(accounts.recover(accountId, input(), "system")).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
        await expect(accounts.recover(accountId, input(), `owner:${owner}`)).rejects.toMatchObject({
          code: "POLICY_REVOKED",
        });
        const foreign = new AccountRepository(db, `foreign-${owner}`, key, () => now);
        await foreign.initialize();
        await expect(
          foreign.recover(accountId, input(), `owner:${foreign.ownerId}`),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect((await accounts.snapshot())[0]?.state).toBe("locked");
      });
      it("stores only a new sealed credential without replaying or settling the old signup", async () => {
        await release();
        const attempts = await db.query("SELECT * FROM signup_attempts WHERE owner_id=$1", [owner]);
        const result = await accounts.recover(accountId, input(), `owner:${owner}`);
        expect(result).toMatchObject({ state: "active", hasCredential: true });
        expect(JSON.stringify(result)).not.toContain(password);
        expect(await accounts.snapshot()).toEqual([result]);
        expect(await db.query("SELECT * FROM signup_attempts WHERE owner_id=$1", [owner])).toEqual(
          attempts,
        );
        expect(attempts[0]?.state).toBe("UNKNOWN");
        expect(
          JSON.stringify(
            await db.query("SELECT envelope FROM vault_secrets WHERE owner_id=$1", [owner]),
          ),
        ).not.toContain(password);
        const audit = await db.query(
          "SELECT payload,actor FROM audit_events WHERE owner_id=$1 AND action='account.recovery_reviewed'",
          [owner],
        );
        expect(JSON.parse(String(audit[0]?.payload))).toMatchObject({
          verification: "owner_attestation",
          credentialReplaced: 1,
          evidenceSha256: "b".repeat(64),
        });
        expect(audit[0]?.actor).toBe(`owner:${owner}`);
        await expect(
          accounts.credential({ accountId, employerOrigin: origin, adapterId }),
        ).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        await repo.setControl({ stopped: false });
        const credential = await accounts.credential({
          accountId,
          employerOrigin: origin,
          adapterId,
        });
        try {
          expect(credential.toString()).toBe(password);
        } finally {
          credential.fill(0);
        }
        await expect(accounts.beginSignup(accountId)).rejects.toMatchObject({
          code: "DUPLICATE_SUSPECTED",
        });
        await expect(accounts.recover(accountId, input(), `owner:${owner}`)).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
      });
      it("closes the restored account without re-enabling preparation or credential access", async () => {
        await release();
        const result = await accounts.recover(
          accountId,
          {
            disposition: "closed",
            expectedUpdatedAt: input().expectedUpdatedAt,
            reviewedAt: now.toISOString(),
            evidenceSha256: "b".repeat(64),
            closePermanently: true,
          },
          `owner:${owner}`,
        );
        expect(result).toMatchObject({ state: "closed", hasCredential: false });
        await repo.setControl({ stopped: false });
        await expect(
          accounts.credential({ accountId, employerOrigin: origin, adapterId }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(
          (
            await accounts.prepare({
              candidateId,
              employerOrigin: origin,
              adapterId,
              identityEmail,
            })
          ).state,
        ).toBe("closed");
      });
      it("refuses stale, future, pre-lock and differently scoped attestations atomically", async () => {
        await release();
        for (const override of [
          { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
          { reviewedAt: "2026-10-14T12:00:00.000Z" },
          { reviewedAt: "2026-10-14T13:00:00.000Z" },
          { identityEmail: "other@example.test" },
          { employerOrigin: "https://other.synthetic.example" },
          { adapterId: "other-adapter" },
        ]) {
          await expect(
            accounts.recover(accountId, { ...input(), ...override }, `owner:${owner}`),
          ).rejects.toThrow();
          expect((await accounts.snapshot())[0]?.state).toBe("locked");
        }
        const stale = input();
        now = new Date("2026-10-14T13:00:00.000Z");
        await expect(accounts.recover(accountId, stale, `owner:${owner}`)).rejects.toMatchObject({
          code: "CONFIG_INVALID",
        });
        expect(
          await db.query("SELECT id FROM vault_secrets WHERE owner_id=$1", [owner]),
        ).toHaveLength(1);
      });
    },
  );
