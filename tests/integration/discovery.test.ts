import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DiscoverySource, sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { pollSource } from "../../packages/discovery/src/connectors.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { DiscoveryRepository } from "../../packages/persistence/src/discovery-repository.js";
import { assertDiscoveryEligibility } from "../../packages/persistence/src/job-identity.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { greenhouseFixture, sourceFixture } from "../helpers/discovery-fixtures.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} discovery persistence`,
    () => {
      let db: Database;
      let repo: DiscoveryRepository;
      let now: number;
      let owner: string;
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        now = Date.parse("2026-09-16T10:00:00Z");
        owner = `discovery-${randomUUID()}`;
        await new CandidateRepository(db, owner).initialize();
        repo = new DiscoveryRepository(db, owner, () => new Date(now));
        await repo.saveSource({
          ...sourceInputSchema.strip().parse(sourceFixture),
          id: undefined,
          expectedRevision: 0,
        });
      });
      afterEach(async () => {
        await db?.close();
      });
      const count = async (table: string) =>
        Number(
          (await db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=$1`, [owner]))[0]
            ?.count,
        );
      async function poll(feed = greenhouseFixture(), elapsed = 301000) {
        now += elapsed;
        const source = await repo.claimSource();
        expect(source).not.toBeNull();
        const claimed = source as DiscoverySource;
        const batch = await pollSource(claimed, async () => ({
          status: 200,
          body: JSON.stringify(feed),
          etag: '"synthetic-feed"',
          retryAfter: null,
        }));
        const run = await repo.ingest(claimed, batch);
        return { claimed, batch, run };
      }
      it("deduplicates polls and established cross-postings into one application", async () => {
        const feed = greenhouseFixture([1, 2]);
        if (feed.jobs[1]) feed.jobs[1].internal_job_id = 101;
        await poll(feed);
        await poll(feed);
        expect(await count("jobs")).toBe(1);
        expect(await count("discovery_listings")).toBe(2);
        const listings = (await repo.snapshot()).listings;
        const a = await repo.createApplication(listings[0]?.jobId ?? "", "candidate");
        const b = await repo.createApplication(listings[1]?.jobId ?? "", "candidate");
        expect(a.id).toBe(b.id);
        expect(await count("applications")).toBe(1);
        expect(await count("tasks")).toBe(0);
      });
      it("fences concurrent and expired polls and honors independent discovery controls", async () => {
        const claims = await Promise.all([repo.claimSource(), repo.claimSource()]);
        expect(claims.filter(Boolean)).toHaveLength(1);
        const old = claims.find(Boolean) as DiscoverySource;
        now += 91000;
        const current = await repo.claimSource();
        expect(current?.leaseToken).not.toBe(old.leaseToken);
        const batch = await pollSource(old, async () => ({
          status: 200,
          body: JSON.stringify(greenhouseFixture()),
          etag: null,
          retryAfter: null,
        }));
        await expect(repo.ingest(old, batch)).rejects.toMatchObject({ code: "LEASE_STALE" });
        await repo.setControl({ discoveryPaused: true });
        await expect(repo.ingest(current as DiscoverySource, batch)).rejects.toMatchObject({
          code: "TASK_CANCELLED",
        });
        expect(await repo.claimSource()).toBeNull();
        expect(await count("jobs")).toBe(0);
      });
      it("distinguishes missing, inferred closed and parser-failed source states", async () => {
        await poll();
        await poll(greenhouseFixture([1, 2]));
        expect((await repo.snapshot()).listings.find((l) => l.job.postingId === "3")?.state).toBe(
          "missing",
        );
        await poll(greenhouseFixture([1, 2]), 86400001);
        const closed = (await repo.snapshot()).listings.find((l) => l.job.postingId === "3");
        expect(closed?.state).toBe("closed");
        now += 301000;
        const source = await repo.claimSource();
        await repo.failSource(source as DiscoverySource, "parser_failed", 0);
        const snapshot = await repo.snapshot();
        expect(snapshot.sources[0]?.health).toBe("parser_failed");
        expect(snapshot.listings.filter((l) => l.state === "open")).toHaveLength(2);
        await expect(
          db.transaction((tx) =>
            assertDiscoveryEligibility(
              tx,
              owner,
              closed?.jobId ?? "",
              "absent",
              new Date(now).toISOString(),
            ),
          ),
        ).rejects.toMatchObject({ code: "JOB_CLOSED" });
      });
      it("retains prior vacancies after a dramatic drop until the owner acknowledges it", async () => {
        await poll(greenhouseFixture(Array.from({ length: 12 }, (_, i) => i + 1)));
        const failed = await poll(greenhouseFixture([1]));
        expect((await repo.snapshot()).sources[0]?.health).toBe("quality_warning");
        expect((await repo.snapshot()).listings.filter((l) => l.state === "open")).toHaveLength(12);
        const evidence = await repo.evidence(failed.run);
        expect(evidence.run.warnings.join(" ")).toContain("dropped sharply");
        expect(evidence.pages[0]?.sha256).toHaveLength(64);
        expect(evidence.pages[0]).not.toHaveProperty("body");
        now += 61000;
        await repo.schedule(failed.claimed.id, true);
        await poll(greenhouseFixture([1]));
        expect((await repo.snapshot()).listings.filter((l) => l.state === "missing")).toHaveLength(
          11,
        );
      });
      it("ingests valid warning records without using them to close unseen vacancies", async () => {
        await poll();
        const warningFeed = greenhouseFixture([1, 2]);
        if (warningFeed.jobs[0]) warningFeed.jobs[0].content = "Short";
        await poll(warningFeed);
        const snapshot = await repo.snapshot();
        expect(snapshot.sources[0]?.health).toBe("quality_warning");
        expect(snapshot.listings.find((l) => l.job.postingId === "1")?.job.description).toBe(
          "Short",
        );
        expect(snapshot.listings.find((l) => l.job.postingId === "3")?.state).toBe("open");
      });
      it("persists 403 pauses and 429 backoff without pausing another source", async () => {
        const source = (await repo.claimSource()) as DiscoverySource;
        await repo.failSource(source, "rate_limited", 600000);
        now += 301000;
        expect(await repo.claimSource()).toBeNull();
        await expect(repo.schedule(source.id)).rejects.toMatchObject({ code: "RATE_LIMITED" });
        const input = sourceInputSchema.strip().parse(sourceFixture);
        await repo.saveSource({
          ...input,
          id: undefined,
          expectedRevision: 0,
          board: "another-synthetic",
        });
        const other = (await repo.claimSource()) as DiscoverySource;
        expect(other.id).not.toBe(source.id);
        await repo.failSource(other, "forbidden", 0);
        now += 900000;
        expect((await repo.claimSource())?.id).toBe(source.id);
        expect((await repo.snapshot()).sources.find((s) => s.id === other.id)?.health).toBe(
          "forbidden",
        );
      });
      it("links dated owner history before discovery and never treats document names as receipts", async () => {
        const history = {
          externalId: "prior-1",
          url: "https://boards.greenhouse.io/synthetic-board/jobs/1?utm_source=old",
          company: "Synthetic Employer",
          title: "Software Engineer 1",
          location: "Amsterdam",
          submitted: true,
          submittedOn: "2026-09-01",
          ownerAssertion: "I submitted this synthetic fixture previously.",
          documents: [{ name: "letter.pdf", sha256: null }],
        };
        expect((await repo.importHistory([history])).imported).toBe(1);
        expect((await repo.importHistory([history])).unchanged).toBe(1);
        await repo.importHistory([
          {
            ...history,
            externalId: "letter-only",
            url: "https://boards.greenhouse.io/synthetic-board/jobs/2",
            submitted: false,
            submittedOn: null,
            ownerAssertion: "",
          },
        ]);
        await poll();
        const snapshot = await repo.snapshot();
        const job = snapshot.listings.find((l) => l.job.postingId === "1");
        const app = await repo.createApplication(job?.jobId ?? "", "candidate");
        expect(app.state).toBe("HISTORICAL_SUBMITTED");
        expect(await count("applications")).toBe(1);
        expect((await repo.summary("demo")).counts.confirmed).toBe(0);
        expect(await count("receipts")).toBe(0);
      });
      it("resolves and reverses ambiguous identity without deleting original jobs", async () => {
        await poll(greenhouseFixture([1, 2]));
        const snapshot = await repo.snapshot();
        const from = snapshot.listings.find((l) => l.job.postingId === "1")?.jobId ?? "";
        const to = snapshot.listings.find((l) => l.job.postingId === "2")?.jobId ?? "";
        const resolution = await repo.mergeJobs(
          from,
          to,
          "Owner verified the same synthetic requisition.",
        );
        const a = await repo.createApplication(from, "candidate");
        const b = await repo.createApplication(to, "candidate");
        expect(a.id).toBe(b.id);
        await poll(greenhouseFixture([1, 2]));
        expect(new Set((await repo.snapshot()).listings.map((l) => l.jobId)).size).toBe(1);
        await repo.splitJobs(resolution);
        expect(new Set((await repo.snapshot()).listings.map((l) => l.jobId)).size).toBe(2);
        expect((await repo.createApplication(from, "candidate")).id).not.toBe(b.id);
        expect(await count("jobs")).toBe(2);
      });
      it("owner-scopes raw source evidence and historical mutations", async () => {
        const { run } = await poll();
        const other = new DiscoveryRepository(db, `other-${owner}`);
        await new CandidateRepository(db, `other-${owner}`).initialize();
        expect((await other.snapshot()).listings).toEqual([]);
        await expect(other.evidence(run)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          other.schedule((await repo.snapshot()).sources[0]?.id ?? ""),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    },
  );
}
