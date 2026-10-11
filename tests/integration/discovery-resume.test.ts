import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DiscoverySource, sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { DiscoveryYield, pollResumable } from "../../packages/discovery/src/resumable.js";
import { runDiscovery } from "../../packages/discovery/src/runner.js";
import type { ReadPublic } from "../../packages/discovery/src/transport.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { DiscoveryScanRepository } from "../../packages/persistence/src/discovery-scan-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { leverFixture, sourceFixture } from "../helpers/discovery-fixtures.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} durable bounded public scans`,
    () => {
      let db: Database;
      let repo: DiscoveryScanRepository;
      let now: number;
      let owner: string;
      let calls: number[];
      const clock = () => new Date(now);
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        now = Date.parse("2026-10-11T01:00:00Z");
        owner = `resume-${randomUUID()}`;
        await new CandidateRepository(db, owner, clock).initialize();
        repo = new DiscoveryScanRepository(db, owner, clock);
        await repo.saveSource({
          ...sourceInputSchema.strip().parse(sourceFixture),
          id: undefined,
          expectedRevision: 0,
          connector: "lever",
        });
        calls = [];
      });
      afterEach(async () => {
        await db?.close();
      });
      const transport: ReadPublic = async (url) => {
        const offset = Number(new URL(url).searchParams.get("skip"));
        calls.push(offset);
        return {
          status: 200,
          body: JSON.stringify(leverFixture(offset, offset < 200 ? 100 : 1)),
          etag: null,
          retryAfter: null,
        };
      };
      const claim = async () => {
        const source = await repo.claimSource();
        if (!source) throw new Error("Synthetic source not claimable.");
        return source;
      };
      const slice = async (source: DiscoverySource, read = transport) =>
        pollResumable(repo, source, read, { maxReads: 2, clock });
      const defer = async (source: DiscoverySource) => {
        await repo.deferScan(source);
        now += 5001;
      };
      const rows = async (table: string) =>
        await db.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [owner]);

      it("resumes through reconstructed repositories, revalidates cached reads and ingests once", async () => {
        let source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        expect(await rows("jobs")).toHaveLength(0);
        expect(await rows("discovery_scan_reads")).toHaveLength(2);
        await defer(source);
        expect((await repo.snapshot()).sources[0]?.health).toBe("scanning");
        expect((await repo.snapshot()).sources[0]?.failures).toBe(0);
        repo = new DiscoveryScanRepository(db, owner, clock);
        source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        expect(calls).toEqual([0, 100, 0, 200]);
        await defer(source);
        source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        expect(calls).toEqual([0, 100, 0, 200, 0, 100]);
        await defer(source);
        source = await claim();
        const batch = await slice(source);
        expect(batch.jobs).toHaveLength(201);
        expect(calls).toEqual([0, 100, 0, 200, 0, 100, 0, 200]);
        // The last batch retains the original middle-page read timestamp.
        expect(batch.pages[1]?.fetchedAt).toBe(new Date(now - 5001).toISOString());
        await repo.ingest(source, batch);
        expect(await rows("jobs")).toHaveLength(201);
        expect(await rows("source_runs")).toHaveLength(1);
        expect(await rows("discovery_scan_reads")).toHaveLength(0);
        expect(await rows("discovery_scans")).toHaveLength(0);
        expect(await rows("attempts")).toHaveLength(0);
      });
      it("detects changed anchor bytes without publishing partial or missing listings", async () => {
        let source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        await defer(source);
        source = await claim();
        const changed: ReadPublic = async () => ({
          status: 200,
          body: JSON.stringify(leverFixture(0, 1)),
          etag: null,
          retryAfter: null,
        });
        await expect(slice(source, changed)).rejects.toMatchObject({ health: "quality_warning" });
        expect(await rows("discovery_scans")).toHaveLength(0);
        expect(await rows("discovery_listings")).toHaveLength(0);
      });
      it("detects drift in a later cached page before ingest", async () => {
        let source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        await defer(source);
        source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        await defer(source);
        source = await claim();
        const changed: ReadPublic = async (url, etag, signal) => {
          if (new URL(url).searchParams.get("skip") === "100")
            return {
              status: 200,
              body: JSON.stringify(leverFixture(100, 99)),
              etag: null,
              retryAfter: null,
            };
          return transport(url, etag, signal);
        };
        await expect(slice(source, changed)).rejects.toMatchObject({ health: "quality_warning" });
        expect(await rows("jobs")).toHaveLength(0);
        expect(await rows("discovery_scan_reads")).toHaveLength(0);
      });
      it("retains successful pages across rate limiting and honors server backoff", async () => {
        const source = await claim();
        const limited: ReadPublic = async (url, etag, signal) =>
          new URL(url).searchParams.get("skip") === "100"
            ? { status: 429, body: "", etag: null, retryAfter: "120" }
            : transport(url, etag, signal);
        await expect(slice(source, limited)).rejects.toMatchObject({
          health: "rate_limited",
          retryAfterMs: 120000,
        });
        await repo.failSource(source, "rate_limited", 120000);
        expect(await rows("discovery_scan_reads")).toHaveLength(1);
        expect(await repo.claimSource()).toBeNull();
        await expect(repo.schedule(source.id)).rejects.toMatchObject({ code: "RATE_LIMITED" });
        now += 120001;
        expect(await repo.claimSource()).not.toBeNull();
      });
      it("fences old leases and stops before transport when discovery is paused", async () => {
        const source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        now += 91000;
        const current = await claim();
        const before = calls.length;
        await expect(slice(source)).rejects.toMatchObject({ code: "LEASE_STALE" });
        await repo.setControl({ discoveryPaused: true });
        await expect(slice(current)).rejects.toMatchObject({ code: "TASK_CANCELLED" });
        expect(calls).toHaveLength(before);
        expect(await rows("jobs")).toHaveLength(0);
      });
      it("invalidates checkpoints on source revision changes and expiry", async () => {
        let source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        now += 61000;
        await repo.schedule(source.id);
        source = await claim();
        expect(await repo.loadScan(source)).toHaveLength(0);
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        await defer(source);
        now += 1800001;
        source = await claim();
        expect(await repo.loadScan(source)).toHaveLength(0);
      });
      it("rejects corrupt durable data and discards it without application mutations", async () => {
        let source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        await defer(source);
        await db.query("UPDATE discovery_scan_reads SET data='not-json' WHERE owner_id=$1", [
          owner,
        ]);
        source = await claim();
        const before = calls.length;
        await expect(slice(source)).rejects.toMatchObject({ health: "parser_failed" });
        expect(calls).toHaveLength(before);
        expect(await rows("discovery_scans")).toHaveLength(0);
        expect(await rows("attempts")).toHaveLength(0);
      });
      it("does not expose another owner's checkpoint to a claimed source", async () => {
        const source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        const other = `other-${randomUUID()}`;
        await new CandidateRepository(db, other, clock).initialize();
        const isolated = new DiscoveryScanRepository(db, other, clock);
        await expect(isolated.loadScan(source)).rejects.toMatchObject({ code: "LEASE_STALE" });
        expect(await rows("discovery_scan_reads")).toHaveLength(2);
      });
      it("rejects noncontiguous writes, future timestamps and exhausted storage atomically", async () => {
        const source = await claim();
        await expect(slice(source)).rejects.toBeInstanceOf(DiscoveryYield);
        const original = (await repo.loadScan(source))[0];
        if (!original) throw new Error("Missing synthetic checkpoint.");
        await expect(repo.saveScanRead(source, { ...original, ordinal: 3 })).rejects.toMatchObject({
          code: "CONFIG_INVALID",
        });
        await expect(
          repo.saveScanRead(source, { ...original, verifiedAt: new Date(now + 1).toISOString() }),
        ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
        // Simulate existing byte allocation to exercise the hard quota without large fixture files.
        await db.query("UPDATE discovery_scan_reads SET bytes=$1 WHERE owner_id=$2 AND ordinal=1", [
          32 * 1024 * 1024,
          owner,
        ]);
        await expect(repo.saveScanRead(source, original)).rejects.toMatchObject({
          code: "CONFIG_INVALID",
        });
        expect(await rows("discovery_scan_reads")).toHaveLength(2);
        expect(await rows("jobs")).toHaveLength(0);
      });
      it("the worker entry point neutrally defers live reads and publishes only a complete scan", async () => {
        const existing = (await repo.snapshot()).sources[0];
        if (!existing) throw new Error("Missing synthetic source.");
        await repo.saveSource({
          ...sourceInputSchema.strip().parse(existing),
          enabled: false,
          expectedRevision: existing.revision,
        });
        repo = new DiscoveryScanRepository(db, owner);
        await repo.saveSource({
          ...sourceInputSchema.strip().parse(sourceFixture),
          id: undefined,
          expectedRevision: 0,
          connector: "lever",
          board: "synthetic-worker",
          mode: "live",
        });
        const read: ReadPublic = async (url) => {
          const offset = Number(new URL(url).searchParams.get("skip"));
          return {
            status: 200,
            body: JSON.stringify(leverFixture(offset, offset < 500 ? 100 : 0)),
            etag: null,
            retryAfter: null,
          };
        };
        expect(await runDiscovery(repo, "local", read)).toBe(true);
        expect(await rows("jobs")).toHaveLength(0);
        expect(await rows("source_runs")).toHaveLength(0);
        const live = (await repo.snapshot()).sources.find((source) => source.mode === "live");
        expect(live?.health).toBe("scanning");
        expect(live?.failures).toBe(0);
        // Unit clock advancement is not soak evidence and does not bypass a server backoff.
        for (let slice = 0; slice < 3 && !(await rows("source_runs")).length; slice++) {
          await db.query(
            "UPDATE sources SET next_poll_at=last_attempt_at WHERE owner_id=$1 AND id=$2",
            [owner, live?.id ?? ""],
          );
          await runDiscovery(repo, "local", read);
        }
        expect(await rows("jobs")).toHaveLength(500);
        expect(await rows("source_runs")).toHaveLength(1);
        expect(await rows("attempts")).toHaveLength(0);
        expect(await rows("discovery_scans")).toHaveLength(0);
      }, 30000);
    },
  );
}
