import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostedOriginSchema } from "../../packages/contracts/src/hosted-preparation.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import {
  assertHostedOriginPermission,
  HostedOriginRepository,
} from "../../packages/persistence/src/hosted-origin-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { RestoreRepository } from "../../packages/persistence/src/restore-repository.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} owner-reviewed hosted origins`,
    () => {
      let db: Database, owner: string, permissions: HostedOriginRepository;
      let now: Date;
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `hosted-origin-${randomUUID()}`;
        now = new Date("2026-10-01T00:00:00.000Z");
        await new Repository(db, owner, () => now).initialize();
        permissions = new HostedOriginRepository(db, owner, () => now);
      });
      afterEach(async () => {
        await db?.close();
      });
      const input = () => ({
        origin: "https://careers.synthetic.test",
        expectedRevision: 0,
        expiresAt: "2026-11-01T00:00:00.000Z",
        publicReadAndLowRiskFillReviewed: true,
      });
      it("requires explicit owner approval and fences stale revisions, revocation and expiry", async () => {
        await expect(permissions.approve(input(), "agent")).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
        await expect(
          permissions.approve(
            { ...input(), publicReadAndLowRiskFillReviewed: false },
            `owner:${owner}`,
          ),
        ).rejects.toThrow();
        const first = await permissions.approve(input(), `owner:${owner}`);
        expect(first).toMatchObject({ state: "active", revision: 1 });
        await expect(permissions.approve(input(), `owner:${owner}`)).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
        expect(
          await assertHostedOriginPermission(db, owner, first.origin, 1, now.toISOString()),
        ).toEqual(first);
        expect(
          await permissions.revoke({ origin: first.origin, expectedRevision: 1 }, `owner:${owner}`),
        ).toMatchObject({ state: "revoked", revision: 2 });
        expect(await permissions.active(first.origin)).toBeNull();
        await expect(
          assertHostedOriginPermission(db, owner, first.origin, 1, now.toISOString()),
        ).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        await permissions.approve({ ...input(), expectedRevision: 2 }, `owner:${owner}`);
        now = new Date(input().expiresAt);
        expect(await permissions.active(first.origin)).toBeNull();
        await expect(
          assertHostedOriginPermission(db, owner, first.origin, 3, now.toISOString()),
        ).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        expect(
          await db.query(
            "SELECT action FROM audit_events WHERE owner_id=$1 AND action LIKE 'hosted_origin.%'",
            [owner],
          ),
        ).toHaveLength(3);
      });
      it("isolates owners and refuses unbounded or already expired approvals", async () => {
        const foreign = `foreign-${randomUUID()}`;
        await new Repository(db, foreign, () => now).initialize();
        await permissions.approve(input(), `owner:${owner}`);
        const other = new HostedOriginRepository(db, foreign, () => now);
        expect(await other.list()).toEqual([]);
        await expect(
          other.revoke({ origin: input().origin, expectedRevision: 1 }, `owner:${foreign}`),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        for (const expiresAt of [now.toISOString(), "2027-10-01T00:00:00.000Z"])
          await expect(
            other.approve({ ...input(), expiresAt }, `owner:${foreign}`),
          ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
        expect(await other.list()).toEqual([]);
      });
      it("rejects altered approval content before it can authorize preparation", async () => {
        const first = await permissions.approve(input(), `owner:${owner}`);
        await db.query(
          "UPDATE hosted_origin_permissions SET expires_at=$1 WHERE owner_id=$2 AND origin=$3",
          ["2026-12-01T00:00:00.000Z", owner, first.origin],
        );
        await expect(permissions.active(first.origin)).rejects.toMatchObject({
          code: "POLICY_REVOKED",
        });
        await expect(
          assertHostedOriginPermission(db, owner, first.origin, 1, now.toISOString()),
        ).rejects.toMatchObject({ code: "POLICY_REVOKED" });
      });
      it("invalidates old public-origin approval during restore before new preparation can proceed", async () => {
        const first = await permissions.approve(input(), `owner:${owner}`);
        await new RestoreRepository(db, owner, () => now).block("a".repeat(64));
        expect(await permissions.active(first.origin)).toBeNull();
        expect(await permissions.list()).toMatchObject([{ state: "revoked", revision: 2 }]);
      });
    },
  );
}
it("refuses non-public shapes, credentials, paths, ports and malformed origin strings", () => {
  for (const origin of [
    "broken",
    "http://careers.test",
    "https://127.0.0.1",
    "https://[::1]",
    "https://localhost",
    "https://private.internal",
    "https://a:b@careers.test",
    "https://careers.test:8443",
    "https://careers.test/jobs",
    "https://careers.test/",
    "https://careers.test?token=secret",
  ])
    expect(hostedOriginSchema.safeParse(origin).success).toBe(false);
});
