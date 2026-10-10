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
    `${engine} SmartRecruiters discovery lifecycle`,
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
        repo = new DiscoveryRepository(db, `smartrecruiters-${randomUUID()}`, () => now);
        await repo.initialize();
        await repo.saveSource({
          ...sourceInputSchema
            .strip()
            .parse({ ...sourceFixture, connector: "smartrecruiters", intervalSeconds: 1200 }),
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
        const batch = await pollSource(source, readFixture, async () => {});
        await repo.ingest(source, batch);
        return batch;
      };
      it("deduplicates summary/detail scans and retains all dated evidence pages", async () => {
        const first = await poll();
        now = new Date(now.getTime() + 1201000);
        await poll();
        expect((await repo.snapshot()).listings).toHaveLength(3);
        expect(first.pages).toHaveLength(4);
        expect(first.pages[1]?.sha256).toMatch(/^[a-f0-9]{64}$/);
        const row = (await new CoverageRepository(db, repo.ownerId).report()).rows.find(
          (item) => item.family === "smartrecruiters",
        );
        expect(row?.openJobs).toBe(3);
        expect(row?.adapterVersion).toBeNull();
        expect(row?.support.commit).toBe("planned");
        expect(row?.support.receipt).toBe("planned");
      });
      it("failed detail reads cannot replace a complete scan or close existing jobs", async () => {
        await poll();
        now = new Date(now.getTime() + 1201000);
        const source = await repo.claimSource();
        if (!source) throw new Error("Missing owned source lease.");
        try {
          await pollSource(
            source,
            async (url) =>
              url.includes("?")
                ? readFixture(url)
                : { status: 404, body: "", etag: null, retryAfter: null },
            async () => {},
          );
          throw new Error("Partial scan unexpectedly accepted.");
        } catch (error) {
          expect(error).toMatchObject({ health: "unavailable" });
          if (!(error instanceof DiscoveryFailure)) throw error;
          expect(error.pages).toHaveLength(2);
          await repo.failSource(source, error.health, error.retryAfterMs, error.pages);
        }
        const snapshot = await repo.snapshot();
        expect(snapshot.sources[0]?.health).toBe("unavailable");
        expect(snapshot.listings.filter((listing) => listing.state === "open")).toHaveLength(3);
      });
    },
  );
}
