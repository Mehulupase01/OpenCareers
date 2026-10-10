import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { pollSource } from "../../packages/discovery/src/connectors.js";
import { readFixture } from "../../packages/discovery/src/fixtures.js";
import { DiscoveryFailure } from "../../packages/discovery/src/transport.js";
import { CoverageRepository } from "../../packages/persistence/src/coverage-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { DiscoveryRepository } from "../../packages/persistence/src/discovery-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { sourceFixture } from "../helpers/discovery-fixtures.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} Personio discovery lifecycle`,
    () => {
      let db: Database;
      let repo: DiscoveryRepository;
      let now: Date;
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        now = new Date("2026-10-10T12:00:00.000Z");
        repo = new DiscoveryRepository(db, `personio-${randomUUID()}`, () => now);
        await repo.initialize();
        await repo.saveSource({
          ...sourceInputSchema.strip().parse({
            ...sourceFixture,
            connector: "personio",
            region: "eu",
            intervalSeconds: 1200,
          }),
          id: undefined,
          expectedRevision: 0,
        });
      });
      afterEach(async () => {
        await db?.close();
      });
      const poll = async () => {
        const source = await repo.claimSource();
        if (!source) throw new Error("Missing owned source lease.");
        const batch = await pollSource(source, readFixture);
        await repo.ingest(source, batch);
        return batch;
      };
      it("deduplicates complete XML snapshots with dated evidence and planned submissions", async () => {
        const first = await poll();
        now = new Date(now.getTime() + 1201000);
        await poll();
        expect((await repo.snapshot()).listings).toHaveLength(3);
        expect(first.pages[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(first.pages[0]?.fetchedAt).toBeTruthy();
        const row = (await new CoverageRepository(db, repo.ownerId).report()).rows.find(
          (item) => item.family === "personio",
        );
        expect(row?.openJobs).toBe(3);
        expect(row?.adapterVersion).toBeNull();
        expect(row?.support.commit).toBe("planned");
        expect(row?.support.receipt).toBe("planned");
      });
      it("schema drift fails the source and never mass-closes its jobs", async () => {
        await poll();
        now = new Date(now.getTime() + 1201000);
        const source = await repo.claimSource();
        if (!source) throw new Error("Missing owned source lease.");
        try {
          await pollSource(source, async () => ({
            status: 200,
            body: "<html/>",
            etag: null,
            retryAfter: null,
          }));
          throw new Error("Drift unexpectedly accepted.");
        } catch (error) {
          expect(error).toMatchObject({ health: "parser_failed" });
          if (!(error instanceof DiscoveryFailure)) throw error;
          await repo.failSource(source, error.health, error.retryAfterMs, error.pages);
        }
        const snapshot = await repo.snapshot();
        expect(snapshot.sources[0]?.health).toBe("parser_failed");
        expect(snapshot.runs.at(0)?.health).toBe("parser_failed");
        expect(snapshot.listings.filter((listing) => listing.state === "open")).toHaveLength(3);
      });
    },
  );
}
