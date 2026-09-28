import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountRepository } from "../../packages/persistence/src/account-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} encrypted employer accounts`,
    () => {
      let db: Database;
      let dir: string;
      let owner: string;
      let candidateId: string;
      const vaultKey = Buffer.alloc(32, 19).toString("base64");

      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-accounts-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "accounts.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `account-${randomUUID()}`;
        const repository = new Repository(db, owner);
        await repository.initialize();
        candidateId = randomUUID();
        await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,$2)", [owner, candidateId]);
      });

      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });

      it("stores only encrypted credentials and returns redacted account metadata", async () => {
        const accounts = new AccountRepository(db, owner, vaultKey);
        const account = await accounts.prepare({
          candidateId,
          employerOrigin: "https://careers.synthetic.example",
          adapterId: "synthetic-signup",
          identityEmail: "candidate@example.test",
        });
        expect(account).toMatchObject({ state: "prepared", hasCredential: true });
        expect(account).not.toHaveProperty("password");
        const credential = await accounts.credential({
          accountId: account.id,
          employerOrigin: account.employerOrigin,
          adapterId: account.adapterId,
        });
        const serialized = JSON.stringify(
          await db.query("SELECT envelope FROM vault_secrets WHERE owner_id=$1", [owner]),
        );
        expect(serialized).not.toContain(credential.toString("utf8"));
        expect(credential).toHaveLength(32);
        expect(await accounts.snapshot()).toEqual([account]);
        credential.fill(0);
      });

      it("deduplicates account preparation and binds credential access to origin and adapter", async () => {
        const accounts = new AccountRepository(db, owner, vaultKey);
        const input = {
          candidateId,
          employerOrigin: "https://careers.synthetic.example",
          adapterId: "synthetic-signup",
          identityEmail: "candidate@example.test",
        };
        const first = await accounts.prepare(input);
        const second = await accounts.prepare(input);
        expect(second.id).toBe(first.id);
        expect(
          await db.query("SELECT id FROM vault_secrets WHERE owner_id=$1", [owner]),
        ).toHaveLength(1);
        await expect(
          accounts.credential({ ...input, accountId: first.id, adapterId: "other-adapter" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          accounts.credential({
            ...input,
            accountId: first.id,
            employerOrigin: "https://other.synthetic.example",
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });

      it("fails closed without a vault key or for non-exact origins", async () => {
        expect(() => new AccountRepository(db, owner, undefined)).toThrow(/vault key/);
        const accounts = new AccountRepository(db, owner, vaultKey);
        await expect(
          accounts.prepare({
            candidateId,
            employerOrigin: "https://careers.synthetic.example/path",
            adapterId: "synthetic-signup",
            identityEmail: "candidate@example.test",
          }),
        ).rejects.toMatchObject({ code: "ORIGIN_DENIED" });
      });
    },
  );
}
