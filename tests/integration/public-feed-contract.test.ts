import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { pollSource } from "../../packages/discovery/src/connectors.js";
import { readFixture } from "../../packages/discovery/src/fixtures.js";
import { CoverageRepository } from "../../packages/persistence/src/coverage-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { DiscoveryRepository } from "../../packages/persistence/src/discovery-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { sourceFixture } from "../helpers/discovery-fixtures.js";

for (const connector of ["teamtailor", "breezy"] as const)
  for (const engine of ["sqlite", "postgres"] as const) {
    describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
      `${engine} ${connector} public feed contract`,
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
          repo = new DiscoveryRepository(db, `feed-${randomUUID()}`, () => now);
          await repo.initialize();
          await repo.saveSource({
            ...sourceInputSchema
              .strip()
              .parse({ ...sourceFixture, connector, intervalSeconds: 1200 }),
            id: undefined,
            expectedRevision: 0,
          });
        });
        afterEach(async () => {
          await db?.close();
        });
        it("deduplicates complete dated scans without application claims", async () => {
          for (let scan = 0; scan < 2; scan++) {
            const source = await repo.claimSource();
            if (!source) throw new Error("Missing owned source lease.");
            const batch = await pollSource(source, readFixture);
            expect(batch.pages).toHaveLength(connector === "breezy" ? 5 : 1);
            expect(batch.pages[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
            await repo.ingest(source, batch);
            now = new Date(now.getTime() + 1201000);
          }
          expect((await repo.snapshot()).listings).toHaveLength(3);
          const row = (await new CoverageRepository(db, repo.ownerId).report()).rows.find(
            (item) => item.family === connector,
          );
          expect(row?.adapterVersion).toBeNull();
          expect(row?.support.commit).toBe("planned");
          expect(row?.support.receipt).toBe("planned");
        });
      },
    );
  }
