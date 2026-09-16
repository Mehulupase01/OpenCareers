import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DomainError, type JobInput } from "../../packages/contracts/src/index.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

const job: JobInput = {
  id: "job-one",
  employerId: "employer",
  requisitionId: "req-1",
  title: "AI Engineer",
  company: "Synthetic Co",
  location: "Amsterdam",
  url: "https://synthetic.example/req-1",
  description: "Synthetic fixture",
  source: "fixture",
  synthetic: true,
};
const postgresUrl = process.env.AUTOPILOT_TEST_DATABASE_URL;
if (process.env.REQUIRE_POSTGRES_TESTS === "1" && !postgresUrl)
  throw new Error("Set AUTOPILOT_TEST_DATABASE_URL to a dedicated test database.");

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !postgresUrl)(`${engine} repository contract`, () => {
    let dir: string;
    let db: Database;
    let second: Database;
    let repository: Repository;
    let peer: Repository;
    let owner: string;
    let now: number;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "opencareers-test-"));
      owner = `test-${randomUUID()}`;
      now = Date.parse("2026-09-16T10:00:00.000Z");
      db =
        engine === "sqlite"
          ? await openSqlite(join(dir, "test.sqlite"))
          : await openPostgres(postgresUrl as string);
      second =
        engine === "sqlite"
          ? await openSqlite(join(dir, "test.sqlite"))
          : await openPostgres(postgresUrl as string);
      await migrate(db);
      await migrate(second);
      repository = new Repository(db, owner, () => new Date(now));
      peer = new Repository(second, owner, () => new Date(now));
      await repository.initialize();
    });
    afterEach(async () => {
      await second?.close();
      await db?.close();
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    it("deduplicates requisitions and application identities without merging distinct roles", async () => {
      const id = await repository.putJob(job);
      expect(await repository.putJob({ ...job, id: "cross-posting", source: "second" })).toBe(id);
      const a = await repository.createApplication(id, "candidate");
      expect((await peer.createApplication(id, "candidate")).id).toBe(a.id);
      await repository.putJob({ ...job, id: "job-two", requisitionId: "req-2" });
      const b = await repository.createApplication("job-two", "candidate", true);
      expect(b.state).toBe("HISTORICAL_SUBMITTED");
      expect((await repository.summary("demo")).counts).toMatchObject({
        jobs: 2,
        applications: 2,
        confirmed: 0,
      });
    });

    it("enforces tenant foreign keys and optimistic transitions with atomic events", async () => {
      await repository.putJob(job);
      const app = await repository.createApplication(job.id, "candidate");
      const updated = await repository.transition(app.id, 0, "NORMALIZED");
      expect(updated.revision).toBe(1);
      await expect(peer.transition(app.id, 0, "NORMALIZED")).rejects.toMatchObject({
        code: "REVISION_STALE",
      });
      await expect(repository.transition(app.id, 1, "CONFIRMED")).rejects.toMatchObject({
        code: "STATE_INVALID",
      });
      const other = new Repository(db, "other-owner");
      await other.initialize();
      await expect(other.createApplication(job.id, "candidate")).rejects.toThrow();
      await expect(other.transition(app.id, 1, "ASSESSED")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await db.query("SELECT * FROM audit_events WHERE owner_id=$1", [owner])).length).toBe(
        2,
      );
      expect((await db.query("SELECT * FROM outbox WHERE owner_id=$1", [owner])).length).toBe(2);
    });

    it("leases once across connections and enforces domain concurrency", async () => {
      await repository.enqueue({ type: "prepare", domain: "company.example", dedupeKey: "one" });
      await repository.enqueue({ type: "prepare", domain: "company.example", dedupeKey: "two" });
      await repository.enqueue({ type: "prepare", domain: "other.example", dedupeKey: "three" });
      // SQLite transactions use synchronous locks; sequential connection entry avoids blocking the shared test event loop.
      const a = await repository.claim("worker-a", ["prepare"]);
      const b = await peer.claim("worker-b", ["prepare"]);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a?.domain).not.toBe(b?.domain);
      expect(await repository.claim("worker-c", ["prepare"])).toBeNull();
      expect(b?.fence).toBeGreaterThan(a?.fence ?? 0);
    });

    it("recovers expired preparation and rejects stale acknowledgement and renewal", async () => {
      await repository.enqueue({
        type: "prepare",
        domain: "company.example",
        dedupeKey: "recover",
        maxAttempts: 2,
      });
      const first = await repository.claim("worker-a", ["prepare"], 1000);
      if (!first) throw new Error("Expected a claim");
      now += 1001;
      const next = await peer.claim("worker-b", ["prepare"], 1000);
      expect(next?.attempts).toBe(2);
      expect(next?.fence).toBeGreaterThan(first.fence);
      await expect(repository.complete(first)).rejects.toMatchObject({ code: "LEASE_STALE" });
      await expect(repository.renew(first)).rejects.toMatchObject({ code: "LEASE_STALE" });
      now += 1001;
      expect(await peer.claim("worker-c", ["prepare"])).toBeNull();
      expect((await repository.summary("demo")).counts.exceptions).toBe(1);
    });

    it("preserves retry budget, dedupe and ready time across connections", async () => {
      const task = await repository.enqueue({
        type: "discover",
        domain: "feed.example",
        dedupeKey: "poll-1",
      });
      expect(
        (await peer.enqueue({ type: "discover", domain: "feed.example", dedupeKey: "poll-1" })).id,
      ).toBe(task.id);
      const claimed = await repository.claim("worker", ["discover"]);
      if (!claimed) throw new Error("Expected a claim");
      await repository.fail(
        claimed,
        new DomainError("STORAGE_UNAVAILABLE", "temporary", true),
        () => 0.5,
      );
      expect(await peer.claim("worker", ["discover"])).toBeNull();
      now += 1000;
      const retried = await peer.claim("worker", ["discover"]);
      expect(retried?.attempts).toBe(2);
      if (retried) await peer.complete(retried);
      expect(await repository.claim("worker", ["discover"])).toBeNull();
    });

    it("turns expired in-flight submission into reconciliation, never a second submit", async () => {
      await repository.putJob(job);
      const app = await repository.createApplication(job.id, "candidate");
      await repository.setControl({ submissionsPaused: false });
      await repository.enqueue({
        type: "submit",
        domain: "company.example",
        dedupeKey: "submit-1",
        applicationId: app.id,
      });
      const first = await repository.claim("worker-a", ["submit"], 1000);
      expect(first).not.toBeNull();
      await db.query("UPDATE applications SET state='IN_FLIGHT' WHERE owner_id=$1 AND id=$2", [
        owner,
        app.id,
      ]);
      now += 1001;
      expect(await peer.claim("worker-b", ["submit"])).toBeNull();
      expect((await repository.summary("demo")).applications[0]?.state).toBe("UNKNOWN");
      expect((await peer.claim("reconciler", ["reconcile"]))?.applicationId).toBe(app.id);
    });

    it("pause and emergency stop stop new leases and revoke active submit leases", async () => {
      await repository.setControl({ submissionsPaused: false });
      await repository.enqueue({
        type: "submit",
        domain: "company.example",
        dedupeKey: "submit-pause",
      });
      const leased = await repository.claim("worker", ["submit"]);
      if (!leased) throw new Error("Expected claim");
      await peer.setControl({ submissionsPaused: true });
      await expect(repository.renew(leased)).rejects.toMatchObject({ code: "LEASE_STALE" });
      await repository.enqueue({
        type: "prepare",
        domain: "company.example",
        dedupeKey: "prepare-paused",
      });
      await peer.setControl({ stopped: true });
      expect(await repository.claim("worker", ["prepare"])).toBeNull();
    });

    it("delivers transactional outbox events once per consumer and rolls back failed effects", async () => {
      await repository.putJob(job);
      await repository.createApplication(job.id, "candidate");
      let calls = 0;
      await expect(
        repository.consumeEvents("bad", async (_event, tx) => {
          await tx.query("UPDATE owners SET next_fence=999 WHERE id=$1", [owner]);
          throw new Error("consumer crashed");
        }),
      ).rejects.toThrow("consumer crashed");
      expect(
        Number(
          (await db.query("SELECT next_fence FROM owners WHERE id=$1", [owner]))[0]?.next_fence,
        ),
      ).toBe(0);
      expect(
        await repository.consumeEvents("counter", async () => {
          calls += 1;
        }),
      ).toBe(1);
      expect(
        await peer.consumeEvents("counter", async () => {
          calls += 1;
        }),
      ).toBe(0);
      expect(calls).toBe(1);
    });

    it("fails closed for unavailable storage and unknown migration versions", async () => {
      if (engine === "sqlite") {
        await db.query("PRAGMA query_only = ON");
        await expect(
          repository.enqueue({ type: "submit", domain: "x", dedupeKey: "disk-full" }),
        ).rejects.toThrow();
        await db.query("PRAGMA query_only = OFF");
        await db.query(
          "INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(99,'future',$1)",
          [new Date(now).toISOString()],
        );
        await expect(migrate(db)).rejects.toMatchObject({ code: "MIGRATION_UNSUPPORTED" });
      } else {
        await expect(
          db.transaction(async (tx) => {
            await tx.query("SET TRANSACTION READ ONLY");
            await tx.query("UPDATE owners SET next_fence=1 WHERE id=$1", [owner]);
          }),
        ).rejects.toThrow();
      }
    });
  });
}
