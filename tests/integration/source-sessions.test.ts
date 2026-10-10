import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SourceSessionInput,
  sourceSessionInputSchema,
} from "../../packages/contracts/src/source-session.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { SourceSessionRepository } from "../../packages/persistence/src/source-session-repository.js";

const key = Buffer.alloc(32, 31).toString("base64");
const input: SourceSessionInput = {
  sourceId: "synthetic-board",
  adapterId: "synthetic-read-v1",
  expectedRevision: 0,
  ownedAccount: true,
  permissionEvidenceSha256: "a".repeat(64),
  expiresAt: "2026-10-10T13:00:00.000Z",
  session: {
    origin: "https://jobs.synthetic.example",
    cookies: [
      {
        name: "session",
        value: "synthetic-private-cookie",
        domain: "jobs.synthetic.example",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
  },
};
const binding = {
  sourceId: input.sourceId,
  adapterId: input.adapterId,
  origin: input.session.origin,
  revision: 1,
  permissionEvidenceSha256: input.permissionEvidenceSha256,
};

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} owner-source session boundaries`,
    () => {
      let dir: string;
      let db: Database;
      let owner: string;
      let repository: SourceSessionRepository;
      let now: Date;
      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-source-sessions-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "fixture.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `source-${randomUUID()}`;
        await new Repository(db, owner).initialize();
        now = new Date("2026-10-10T12:00:00.000Z");
        repository = new SourceSessionRepository(db, owner, key, () => now);
      });
      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });
      it("stores ciphertext only and exposes redacted metadata", async () => {
        await repository.store(input);
        expect(await repository.read(binding)).toEqual(input.session);
        const stored =
          JSON.stringify(await db.query("SELECT * FROM vault_secrets WHERE owner_id=$1", [owner])) +
          JSON.stringify(await db.query("SELECT * FROM audit_events WHERE owner_id=$1", [owner])) +
          JSON.stringify(await repository.snapshot());
        expect(stored).not.toContain("synthetic-private-cookie");
        expect(stored).not.toContain('"cookies"');
        expect((await repository.snapshot())[0]).toMatchObject({ state: "stored", revision: 1 });
      });
      it("binds access to owner, source, adapter, exact origin, revision and permission evidence", async () => {
        await repository.store(input);
        for (const wrong of [
          { sourceId: "other-board" },
          { adapterId: "other-adapter" },
          { origin: "https://jobs.synthetic.example.evil.test" },
          { revision: 2 },
          { permissionEvidenceSha256: "b".repeat(64) },
        ])
          await expect(repository.read({ ...binding, ...wrong })).rejects.toMatchObject({
            code: "SESSION_EXPIRED",
          });
        const other = `other-${owner}`;
        await new Repository(db, other).initialize();
        await expect(
          new SourceSessionRepository(db, other, key, () => now).read(binding),
        ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      });
      it("replaces secrets transactionally and rejects stale replacements", async () => {
        await repository.store(input);
        await expect(repository.store(input)).rejects.toMatchObject({ code: "STATE_INVALID" });
        await repository.store({
          ...input,
          expectedRevision: 1,
          session: {
            ...input.session,
            cookies: input.session.cookies.map((cookie) => ({
              ...cookie,
              value: "synthetic-new-cookie",
            })),
          },
        });
        expect(
          await db.query("SELECT id FROM vault_secrets WHERE owner_id=$1", [owner]),
        ).toHaveLength(1);
        await expect(repository.read(binding)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
        expect((await repository.read({ ...binding, revision: 2 })).cookies[0]?.value).toBe(
          "synthetic-new-cookie",
        );
      });
      it("expires without replay and refuses stale cookies or overlong authority", async () => {
        await expect(
          repository.store({ ...input, expiresAt: "2026-10-12T12:00:00.000Z" }),
        ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
        await expect(
          repository.store({
            ...input,
            session: {
              ...input.session,
              cookies: input.session.cookies.map((cookie) => ({ ...cookie, expires: 1 })),
            },
          }),
        ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
        await repository.store(input);
        now = new Date("2026-10-10T13:00:00.000Z");
        expect((await repository.snapshot())[0]?.state).toBe("expired");
        await expect(repository.read(binding)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      });
      it("stop prevents access but cannot prevent revocation or ciphertext deletion", async () => {
        await repository.store(input);
        await repository.setControl({ stopped: true });
        await expect(repository.read(binding)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        await repository.revoke(input.sourceId, 1);
        expect((await repository.snapshot())[0]?.state).toBe("revoked");
        expect(
          await db.query("SELECT id FROM vault_secrets WHERE owner_id=$1", [owner]),
        ).toHaveLength(0);
      });
      it("discovery pause prevents credential acquisition", async () => {
        await repository.store(input);
        await repository.setControl({ discoveryPaused: true });
        await expect(repository.read(binding)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
      });
      it("restore review blocks credential reads while allowing local revocation without a key", async () => {
        await repository.store(input);
        await db.query("UPDATE controls SET data=$1 WHERE owner_id=$2", [
          JSON.stringify({ ...(await repository.getControl()), restoreBlocked: true }),
          owner,
        ]);
        await expect(repository.read(binding)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        const noKey = new SourceSessionRepository(db, owner, undefined, () => now);
        await noKey.revoke(input.sourceId, 1);
        expect((await noKey.snapshot())[0]?.state).toBe("revoked");
        expect(
          await db.query("SELECT id FROM vault_secrets WHERE owner_id=$1", [owner]),
        ).toHaveLength(0);
      });
      it("does not expose plaintext on key mismatch", async () => {
        await repository.store(input);
        await expect(
          new SourceSessionRepository(
            db,
            owner,
            Buffer.alloc(32, 32).toString("base64"),
            () => now,
          ).read(binding),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });
      it.each(["cf_clearance", "__cf_bm", "g-recaptcha-response", "datadome"])(
        "rejects challenge cookie %s instead of persisting bypass state",
        async (name) => {
          expect(
            sourceSessionInputSchema.safeParse({
              ...input,
              session: {
                ...input.session,
                cookies: input.session.cookies.map((cookie) => ({ ...cookie, name })),
              },
            }).success,
          ).toBe(false);
          expect(
            await db.query("SELECT id FROM vault_secrets WHERE owner_id=$1", [owner]),
          ).toHaveLength(0);
        },
      );
      it("refuses parent-domain, insecure and duplicated cookies", () => {
        const cookie = input.session.cookies[0];
        if (!cookie) throw new Error("Missing fixture cookie");
        for (const cookies of [
          [{ ...cookie, domain: ".synthetic.example" }],
          [{ ...cookie, secure: false }],
          [cookie, cookie],
          [cookie, { ...cookie, domain: `.${cookie.domain}` }],
        ])
          expect(
            sourceSessionInputSchema.safeParse({ ...input, session: { ...input.session, cookies } })
              .success,
          ).toBe(false);
      });
    },
  );
}
