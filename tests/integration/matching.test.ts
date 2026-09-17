import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../packages/config/src/index.js";
import { sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { DomainError } from "../../packages/contracts/src/index.js";
import { MatchingRunner } from "../../packages/inference/src/gateway.js";
import { deterministicGates, scoreMatch } from "../../packages/matching/src/domain.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { DiscoveryRepository } from "../../packages/persistence/src/discovery-repository.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { identity, policy } from "../helpers/candidate-fixtures.js";
import { greenhouseFixture, sourceFixture } from "../helpers/discovery-fixtures.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} matching persistence`,
    () => {
      let db: Database;
      let owner: string;
      let now: number;
      let candidate: CandidateRepository;
      let discovery: DiscoveryRepository;
      let matching: MatchingRepository;

      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `matching-${randomUUID()}`;
        now = Date.parse("2026-09-16T10:00:00.000Z");
        const clock = () => new Date(now);
        candidate = new CandidateRepository(db, owner, clock);
        discovery = new DiscoveryRepository(db, owner, clock);
        matching = new MatchingRepository(db, owner, clock);
        await candidate.initialize();
        await matching.setFixtureRoute("synthetic/model:free", "synthetic-provider");
      });

      afterEach(async () => {
        await db?.close();
      });

      async function profileAndJob() {
        await candidate.saveFact(identity);
        await candidate.saveFact({
          expectedRevision: 0,
          key: "skill.python",
          value: { kind: "skill", name: "Python", firstUsed: "2020-01" },
          provenance: { kind: "owner", statement: "Synthetic Python evidence." },
          expiresOn: null,
        });
        await candidate.saveFact({
          expectedRevision: 0,
          key: "work.nl",
          value: {
            kind: "work_authorization",
            country: "NL",
            currentlyAuthorized: "yes",
            permitExpiresOn: "2027-09-16",
            futureSponsorship: "no",
            approvedWording: "Synthetic authorization wording.",
          },
          provenance: { kind: "owner", statement: "Synthetic work authorization evidence." },
          expiresOn: null,
        });
        const profile = await candidate.publishProfile((await candidate.snapshot()).revision);
        await candidate.saveAuthorization(policy(profile.id));
        await discovery.saveSource({
          ...sourceInputSchema.strip().parse(sourceFixture),
          id: undefined,
          expectedRevision: 0,
        });
        now += 301000;
        const source = await discovery.claimSource();
        if (!source) throw new Error("Expected synthetic source claim.");
        const batch = await import("../../packages/discovery/src/connectors.js").then(
          ({ pollSource }) =>
            pollSource(source, async () => ({
              status: 200,
              body: JSON.stringify(greenhouseFixture([1])),
              etag: '"matching-fixture"',
              retryAfter: null,
            })),
        );
        await discovery.ingest(source, batch);
        const jobId = (await discovery.snapshot()).listings[0]?.jobId;
        if (!jobId) throw new Error("Expected synthetic discovered job.");
        return { profile, jobId };
      }

      it("reserves a daily quota atomically and retains sent usage across repository restarts", async () => {
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () =>
            matching.reserve("synthetic/model:free", "synthetic-provider", 3),
          ),
        );
        const reserved = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        expect(reserved).toHaveLength(3);
        await matching.markSent(reserved[0]?.id ?? "", "a".repeat(64));
        await matching.finish(reserved[0]?.id ?? "", {
          status: "completed",
          responseHash: "b".repeat(64),
        });
        await matching.release(reserved[1]?.id ?? "");
        const restarted = new MatchingRepository(db, owner, () => new Date(now));
        await expect(
          restarted.reserve("synthetic/model:free", "synthetic-provider", 3),
        ).resolves.toMatchObject({ state: "reserved" });
        await expect(
          restarted.reserve("synthetic/model:free", "synthetic-provider", 3),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
      });

      it("releases only unsent expired reservations and keeps sent attempts counted", async () => {
        const unsent = await matching.reserve("synthetic/model:free", "synthetic-provider", 2);
        const sent = await matching.reserve("synthetic/model:free", "synthetic-provider", 2);
        await matching.markSent(sent.id, "c".repeat(64));
        now += 61000;
        const replacement = await matching.reserve("synthetic/model:free", "synthetic-provider", 2);
        expect(replacement.id).not.toBe(unsent.id);
        await expect(
          matching.reserve("synthetic/model:free", "synthetic-provider", 2),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
      });

      it("persists owner-scoped route evidence and bounded backoff", async () => {
        const catalogue = {
          data: [
            {
              id: "synthetic/model:free",
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["structured_outputs", "response_format"],
            },
          ],
        };
        await matching.setRoute(catalogue, {
          eligible: true,
          modelId: "synthetic/model:free",
          provider: "synthetic-provider",
          reasons: [],
          catalogueFetchedAt: new Date(now).toISOString(),
        });
        expect((await matching.snapshot(5)).route).toMatchObject({
          status: "ready",
          modelId: "synthetic/model:free",
          provider: "synthetic-provider",
        });
        await matching.setUnavailable(
          "rate_limited",
          "Synthetic bounded backoff.",
          new Date(now + 120000).toISOString(),
        );
        await expect(
          matching.reserve("synthetic/model:free", "synthetic-provider", 5),
        ).rejects.toMatchObject({ code: "MODEL_ROUTE_INELIGIBLE" });
        const other = new MatchingRepository(db, `other-${owner}`, () => new Date(now));
        await new CandidateRepository(db, `other-${owner}`, () => new Date(now)).initialize();
        expect((await other.snapshot(5)).route.status).toBe("unconfigured");
      });

      it("stores immutable profile-bound assessments and removes completed jobs from pending work", async () => {
        const { profile, jobId } = await profileAndJob();
        expect(await matching.pendingJobIds()).toEqual([jobId]);
        const input = await matching.input(jobId);
        const gates = deterministicGates(input, "2026-09-16");
        const score = scoreMatch(gates, [], 0);
        const saved = await matching.saveAssessment({
          id: randomUUID(),
          revision: 1,
          jobId,
          applicationId: null,
          profileId: profile.id,
          outcome: "inference_paused",
          gates,
          requirements: [],
          score,
          modelId: null,
          provider: null,
          explanation: "Synthetic route intentionally paused.",
          createdAt: new Date(now).toISOString(),
        });
        expect(saved.revision).toBe(1);
        expect(await matching.pendingJobIds()).toEqual([]);
        expect((await matching.snapshot(5)).assessments[0]).toMatchObject({
          jobId,
          profileId: profile.id,
        });
        now += 86400000;
        expect(await matching.pendingJobIds()).toEqual([jobId]);
      });

      it("runs synthetic inference through durable quota and advances only validated eligibility", async () => {
        const { jobId } = await profileAndJob();
        const runner = new MatchingRunner(matching, loadConfig({}));
        const assessment = await runner.assessNow(jobId);
        expect(assessment).toMatchObject({
          jobId,
          outcome: "auto_eligible",
          modelId: "synthetic/model:free",
          provider: "synthetic-provider",
        });
        expect(assessment.requirements[0]).toMatchObject({
          status: "met",
          factIds: [expect.any(String)],
        });
        expect((await matching.snapshot(40)).budget.used).toBe(1);
        const application = (
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND job_id=$2", [
            owner,
            jobId,
          ])
        )[0];
        expect(application?.state).toBe("ELIGIBLE");
      });

      it("records upstream rate limits as a scoped pause instead of crashing the runner", async () => {
        const { jobId } = await profileAndJob();
        const config = {
          ...loadConfig({}),
          profile: "local" as const,
          inference: {
            enabled: true,
            apiKey: "synthetic-private-key-not-real",
            dailyLimit: 5,
            modelAllowlist: ["synthetic/model:free"],
            providerAllowlist: ["synthetic-provider"],
          },
        };
        const runner = new MatchingRunner(matching, config, {
          catalogue: async () => ({
            data: [
              {
                id: "synthetic/model:free",
                context_length: 16000,
                architecture: { input_modalities: ["text"], output_modalities: ["text"] },
                pricing: { prompt: "0", completion: "0" },
                supported_parameters: ["structured_outputs", "response_format"],
              },
            ],
          }),
          complete: async () => {
            throw new DomainError("RATE_LIMITED", "Synthetic bounded rate limit.", true);
          },
        });
        await expect(runner.assessNow(jobId)).resolves.toMatchObject({
          outcome: "inference_paused",
        });
        expect((await matching.snapshot(5)).route.status).toBe("rate_limited");
      });

      it("refuses stale profile authorization without stopping unrelated worker progress", async () => {
        const { jobId } = await profileAndJob();
        await candidate.saveFact({
          expectedRevision: 0,
          key: "skill.typescript",
          value: { kind: "skill", name: "TypeScript", firstUsed: "2021-01" },
          provenance: { kind: "owner", statement: "Synthetic TypeScript evidence." },
          expiresOn: null,
        });
        await candidate.publishProfile((await candidate.snapshot()).revision);
        await expect(matching.input(jobId)).rejects.toMatchObject({ code: "PROFILE_STALE" });
        expect(await matching.pendingJobIds()).toEqual([]);
        const runner = new MatchingRunner(matching, loadConfig({}));
        await expect(runner.run()).resolves.toBeUndefined();
      });
    },
  );
}
