import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DiscoverySource, sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { jobInputSchema } from "../../packages/contracts/src/index.js";
import { pollSource } from "../../packages/discovery/src/connectors.js";
import { deterministicGates, scoreMatch } from "../../packages/matching/src/domain.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import { CoverageRepository } from "../../packages/persistence/src/coverage-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { DiscoveryRepository } from "../../packages/persistence/src/discovery-repository.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { identity } from "../helpers/candidate-fixtures.js";
import { greenhouseFixture, sourceFixture } from "../helpers/discovery-fixtures.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} portal coverage`,
    () => {
      let db: Database;
      let owner: string;
      let now: number;
      let candidate: CandidateRepository;
      let discovery: DiscoveryRepository;
      let matching: MatchingRepository;
      let coverage: CoverageRepository;

      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `coverage-${randomUUID()}`;
        now = Date.parse("2026-09-27T10:00:00Z");
        candidate = new CandidateRepository(db, owner, () => new Date(now));
        await candidate.initialize();
        discovery = new DiscoveryRepository(db, owner, () => new Date(now));
        matching = new MatchingRepository(db, owner, () => new Date(now));
        coverage = new CoverageRepository(db, owner, () => new Date(now));
      });

      afterEach(async () => db.close());

      it("ranks complete open-corpus coverage using the active profile's latest assessment", async () => {
        await candidate.saveFact(identity);
        await candidate.saveFact({
          expectedRevision: 0,
          key: "skill.python",
          value: { kind: "skill", name: "Python", firstUsed: "2020-01" },
          provenance: { kind: "owner", statement: "Synthetic evidence." },
          expiresOn: null,
        });
        const profile = await candidate.publishProfile((await candidate.snapshot()).revision);
        await discovery.saveSource({
          ...sourceInputSchema.strip().parse(sourceFixture),
          id: undefined,
          expectedRevision: 0,
        });
        now += 301000;
        const source = (await discovery.claimSource()) as DiscoverySource;
        await discovery.ingest(
          source,
          await pollSource(source, async () => ({
            status: 200,
            body: JSON.stringify(
              greenhouseFixture(Array.from({ length: 51 }, (_, index) => index + 1)),
            ),
            etag: '"coverage"',
            retryAfter: null,
          })),
        );
        const listings = (await discovery.snapshot()).listings;
        const assessed = listings[0];
        if (!assessed) throw new Error("Expected a discovered listing.");
        const input = {
          job: jobInputSchema.strip().parse(assessed.job),
          facts: [],
          profileId: profile.id,
          roleTerms: ["software engineer"],
          countries: ["NL"],
          salaryMinimum: null,
          salaryNegotiable: null,
          listingState: "open" as const,
          duplicate: false,
        };
        const gates = deterministicGates(input, "2026-09-27");
        await matching.saveAssessment({
          id: randomUUID(),
          revision: 1,
          jobId: assessed.jobId,
          applicationId: null,
          profileId: profile.id,
          outcome: "auto_eligible",
          gates,
          requirements: [],
          score: scoreMatch(gates, [], 0),
          modelId: null,
          provider: null,
          explanation: "Synthetic eligibility evidence.",
          createdAt: new Date(now).toISOString(),
        });
        const report = await coverage.report();
        expect(report).toMatchObject({
          activeProfileId: profile.id,
          totals: { openJobs: 51, autoEligible: 1, unassessed: 50 },
          recommendedNextFamily: "greenhouse",
        });
        expect(report.rows[0]).toMatchObject({
          family: "greenhouse",
          openJobs: 51,
          eligibility: { auto_eligible: 1, unassessed: 50 },
          variants: [
            { key: "global:synthetic-board", openJobs: 51, eligibility: { auto_eligible: 1 } },
          ],
          accountNeed: "unknown",
          challengeNeed: "unknown",
          adapterVersion: null,
        });
      });
    },
  );
}
