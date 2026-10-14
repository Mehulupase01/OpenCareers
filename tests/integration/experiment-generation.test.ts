import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInspectionTask } from "../../apps/worker/src/inspection.js";
import { runVariantPreparation } from "../../apps/worker/src/variant-preparation.js";
import { createAdapterRegistry } from "../../packages/browser/src/adapter-sdk.js";
import type { DryRunResult } from "../../packages/contracts/src/browser.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { compileLetterProposal } from "../../packages/documents/src/letter-draft.js";
import { LetterDraftRunner } from "../../packages/documents/src/letter-gateway.js";
import { letterVariantRecipes } from "../../packages/documents/src/letter-variants.js";
import { startMockAts } from "../../packages/mock-ats/src/server.js";
import { BrowserRepository } from "../../packages/persistence/src/browser-repository.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
  type Row,
  type SqlValue,
} from "../../packages/persistence/src/database.js";
import { DiscoveryRepository } from "../../packages/persistence/src/discovery-repository.js";
import { generationSubmissionHeld } from "../../packages/persistence/src/experiment-generation-binding.js";
import { ExperimentGenerationRepository } from "../../packages/persistence/src/experiment-generation-repository.js";
import {
  assertExperimentDispatch,
  ExperimentRepository,
} from "../../packages/persistence/src/experiment-repository.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { RestoreRepository } from "../../packages/persistence/src/restore-repository.js";
import { SubmissionRepository } from "../../packages/persistence/src/submission-repository.js";
import {
  documentAssessment,
  documentAuthorization,
  documentFacts,
  documentJob,
  documentProfile,
} from "../fixtures/document-packets.js";
import { syntheticCatalogue } from "../helpers/route-fixtures.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const recipe = () => {
  const item = letterVariantRecipes().find((item) => item.id === "concise");
  if (!item) throw new Error("Missing concise recipe");
  return { id: item.id, version: item.version, sha256: item.sha256 };
};

function readyResult(packet: PacketSnapshot): DryRunResult {
  const snapshots = [1, 2].map((step) => ({
    step,
    url: "http://127.0.0.1:4320/jobs/standard",
    origin: "http://127.0.0.1:4320",
    jobId: packet.manifest.jobId,
    blocker: "none" as const,
    fingerprint: String(step).repeat(64),
    fields: [
      {
        name: "full_name",
        semanticKey: "full_name",
        label: "Full name",
        kind: "text" as const,
        required: true,
        maxLength: null,
        options: [],
      },
    ],
  }));
  const expected = packet.content.cv.identity.fullName;
  return {
    adapter: { id: "mock-ats", version: "mock-ats-v1", targetFingerprint: "c".repeat(64) },
    packetId: packet.manifest.id,
    applicationId: packet.manifest.applicationId,
    status: "ready",
    snapshots,
    plans: snapshots.map((snapshot) => ({
      fingerprint: snapshot.fingerprint,
      entries: [
        { name: "full_name", semanticKey: "full_name", expected, evidence: ["fact-identity"] },
      ],
      unresolved: [],
    })),
    reports: snapshots.map((snapshot) => ({
      snapshot,
      status: "ready",
      uploadStatus: "accepted",
      readBack: [{ name: "full_name", expected, actual: expected, matches: true }],
      issues: [],
    })),
    issues: [],
    blockedFinalActions: 0,
    serverApplicationCount: 0,
    preparedAt: "2026-09-17T09:00:00.000Z",
  };
}

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} recipe-bound experiment generation`,
    () => {
      let db: Database;
      let dir: string;
      let owner: string;
      let now: Date;
      let repo: ExperimentGenerationRepository;
      let experiments: ExperimentRepository;
      let artifacts: ArtifactStore;
      const clock = () => now;

      async function application(jobId: string = randomUUID()) {
        await repo.putJob({
          ...documentJob,
          id: jobId,
          requisitionId: jobId,
          ...(jobId === "synthetic-engineer-1"
            ? { url: "http://127.0.0.1:4320/jobs/standard" }
            : {}),
        });
        const app = await repo.createApplication(jobId, documentProfile.candidateId);
        await db.query(
          "UPDATE applications SET state='ELIGIBLE',revision=revision+1 WHERE owner_id=$1 AND id=$2",
          [owner, app.id],
        );
        const assessment = {
          ...documentAssessment,
          id: randomUUID(),
          jobId,
          applicationId: app.id,
        };
        await db.query(
          "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,application_id,revision,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)",
          [
            owner,
            assessment.id,
            jobId,
            documentProfile.id,
            app.id,
            JSON.stringify(assessment),
            digest(assessment),
            assessment.createdAt,
          ],
        );
        return { app, assessment, jobId };
      }

      async function experiment(maximumAssignments = 3, automatic = true) {
        const id = randomUUID();
        await experiments.create({
          id,
          metric: "INTERVIEW",
          observationDays: 30,
          expiresAt: "2026-10-17T09:00:00.000Z",
          maximumAssignments,
          variants: [
            { id: "baseline", kind: "wording", approvalSha256: "a".repeat(64) },
            {
              id: "concise",
              kind: "wording",
              approvalSha256: "b".repeat(64),
              ...(automatic ? { generationRecipe: recipe() } : {}),
            },
          ],
        });
        return id;
      }

      async function request(experimentId?: string, jobId?: string) {
        experimentId ??= await experiment();
        const item = await application(jobId);
        const revision = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            item.app.id,
          ])
        )[0];
        return {
          ...item,
          raw: {
            id: randomUUID(),
            experimentId,
            variantId: "concise",
            applicationId: item.app.id,
            assessmentId: item.assessment.id,
            expectedApplicationRevision: Number(revision?.revision),
            expectedExperimentRevision: 1,
            reviewed: true as const,
          },
        };
      }

      async function drafting() {
        const item = await request();
        await repo.create(item.raw);
        const task = await repo.claim("synthetic-generator", ["prepare"]);
        if (!task) throw new Error("Expected generation lease");
        const begun = await repo.begin(task, item.raw.id);
        if (!begun.input) throw new Error("Expected fresh input");
        return { ...item, task, input: begun.input, recipe: begun.recipe };
      }

      async function build(item: Awaited<ReturnType<typeof drafting>>, bound = true) {
        const content = generatePacketContent(item.input);
        const letter = compileLetterProposal(item.input, content, {
          opening: content.letter.opening,
          motivation: "The role's focus on Python makes this opportunity compelling.",
          contributionIds: content.letter.contributions.map((claim) => claim.id).slice(0, 2),
        });
        return buildPacket(artifacts, item.input, {
          letter,
          modelId: "synthetic/model:free",
          provider: "synthetic-provider",
          responseHash: "d".repeat(64),
          ...(bound ? { recipe: item.recipe, generationId: item.raw.id } : {}),
        });
      }

      const review = { critiqueHash: "e".repeat(64), repaired: false };
      const rows = (table: string) =>
        db.query(`SELECT * FROM ${table} WHERE owner_id=$1 ORDER BY id`, [owner]);
      const guard = (applicationId: string, packetId: string) =>
        db.transaction((tx) =>
          assertExperimentDispatch(tx, owner, applicationId, packetId, now.toISOString()),
        );

      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-generation-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "generation.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `generation-${randomUUID()}`;
        now = new Date("2026-09-17T09:00:00.000Z");
        repo = new ExperimentGenerationRepository(db, owner, clock);
        await new CandidateRepository(db, owner, clock).initialize();
        experiments = new ExperimentRepository(db, owner, clock);
        artifacts = new ArtifactStore(await realpath(dir));
        await artifacts.initialize();
        await db.query(
          "INSERT INTO profile_versions(id,owner_id,candidate_id,revision,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            documentProfile.id,
            owner,
            documentProfile.candidateId,
            documentProfile.revision,
            JSON.stringify(documentProfile),
            documentProfile.createdAt,
          ],
        );
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            documentAuthorization.id,
            owner,
            documentAuthorization.revision,
            JSON.stringify(documentAuthorization),
            documentAuthorization.effectiveAt,
            documentAuthorization.expiresAt,
          ],
        );
        await db.query(
          "UPDATE candidates SET id=$1,active_profile_id=$2,active_authorization_id=$3 WHERE owner_id=$4",
          [documentProfile.candidateId, documentProfile.id, documentAuthorization.id, owner],
        );
        for (const fact of documentFacts) {
          await db.query(
            "INSERT INTO fact_versions(owner_id,id,revision,candidate_id,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
            [
              owner,
              fact.id,
              fact.revision,
              documentProfile.candidateId,
              JSON.stringify(fact),
              fact.recordedAt,
            ],
          );
          await db.query("INSERT INTO fact_heads(owner_id,id,revision) VALUES($1,$2,$3)", [
            owner,
            fact.id,
            fact.revision,
          ]);
        }
      });

      afterEach(async () => {
        vi.restoreAllMocks();
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });

      it("enrolls once with strict reviewed input and an owned bounded prepare task", async () => {
        const { raw } = await request();
        expect(await repo.eligibleApplications()).toEqual([
          expect.objectContaining({
            applicationId: raw.applicationId,
            assessmentId: raw.assessmentId,
          }),
        ]);
        await expect(repo.create({ ...raw, reviewed: false })).rejects.toThrow();
        await expect(repo.create({ ...raw, prompt: "unreviewed override" })).rejects.toThrow();
        await expect(repo.create({ ...raw, id: "not-a-uuid" })).rejects.toThrow();
        expect(await rows("tasks")).toEqual([]);
        const created = await repo.create(raw);
        expect(created).toMatchObject({
          id: raw.id,
          state: "queued",
          recipe: recipe(),
          packetId: null,
        });
        expect(await repo.create(raw)).toEqual(created);
        await expect(repo.create({ ...raw, variantId: "baseline" })).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
        expect(await rows("tasks")).toEqual([
          expect.objectContaining({
            type: "prepare",
            domain: "documents",
            priority: 50,
            max_attempts: 2,
          }),
        ]);
        expect(await repo.list(raw.experimentId)).toEqual([created]);
        expect(await repo.list(randomUUID())).toEqual([]);
        expect(
          await new ExperimentGenerationRepository(db, `other-${randomUUID()}`, clock).list(),
        ).toEqual([]);
        expect(await repo.eligibleApplications()).toEqual([]);
      });

      it.each(["manual", "application revision", "experiment revision"])(
        "refuses %s enrollment without queued work",
        async (reason) => {
          const { raw } = await request(await experiment(3, reason !== "manual"));
          if (reason === "application revision") raw.expectedApplicationRevision++;
          if (reason === "experiment revision") raw.expectedExperimentRevision++;
          await expect(repo.create(raw)).rejects.toMatchObject({
            code: reason === "application revision" ? "REVISION_STALE" : "POLICY_REVOKED",
          });
          expect(await repo.list()).toEqual([]);
          expect(await rows("tasks")).toEqual([]);
        },
      );

      it("counts pending requests against quota and rejects duplicate canonical enrollment", async () => {
        const id = await experiment(2);
        const first = await request(id);
        const second = await request(id);
        const third = await request(id);
        await repo.create(first.raw);
        await expect(repo.create({ ...first.raw, id: randomUUID() })).rejects.toMatchObject({
          code: "DUPLICATE_SUSPECTED",
        });
        await repo.create(second.raw);
        await expect(repo.create(third.raw)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        expect(await repo.list(id)).toHaveLength(2);
        expect(await rows("tasks")).toHaveLength(2);
      });

      it("rejects enrollment and publication across a canonical job merge", async () => {
        const item = await drafting();
        const other = await request(item.raw.experimentId);
        await db.query(
          "INSERT INTO identity_resolutions(id,owner_id,from_job_id,to_job_id,reason,created_at) VALUES($1,$2,$3,$4,'synthetic-equivalence',$5)",
          [randomUUID(), owner, item.jobId, other.jobId, now.toISOString()],
        );
        await expect(repo.create(other.raw)).rejects.toMatchObject({ code: "DUPLICATE_SUSPECTED" });
        await expect(repo.assertCurrent(item.task, item.raw.id)).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
        await expect(
          repo.publish(item.task, item.raw.id, await build(item), review),
        ).rejects.toMatchObject({ code: "REVISION_STALE" });
        expect(await rows("packets")).toEqual([]);
        expect(await repo.list()).toHaveLength(1);
      });

      it.each(["stopped", "global stop", "paused", "revoked", "answers", "facts", "lease"])(
        "rejects %s changes after drafting before publication",
        async (change) => {
          const item = await drafting();
          const built = await build(item);
          if (change === "stopped")
            await experiments.stop(item.raw.experimentId, { expectedRevision: 1 });
          if (change === "global stop") await repo.setControl({ stopped: true });
          if (change === "paused") await repo.setControl({ preparationPaused: true });
          if (change === "revoked")
            await new CandidateRepository(db, owner, clock).revokeAuthorization(
              documentAuthorization.id,
            );
          if (change === "answers")
            await new CandidateRepository(db, owner, clock).saveAnswer({
              semanticKey: "sponsorship_required",
              meaning: "Sponsorship",
              answer: "no",
              validFrom: "2026-09-01",
              validUntil: "2026-10-01",
              employerIds: [documentJob.employerId],
              countries: ["NL"],
              evidenceFactIds: ["fact-work-nl"],
            });
          if (change === "facts") {
            const fact = documentFacts.find((fact) => fact.id === "fact-python");
            if (!fact) throw new Error("Missing Python fact");
            await new CandidateRepository(db, owner, clock).saveFact({
              id: fact.id,
              expectedRevision: fact.revision,
              key: fact.key,
              value: fact.value,
              provenance: fact.provenance,
              expiresOn: fact.expiresOn,
            });
          }
          if (change === "lease") now = new Date(now.getTime() + 31000);
          await expect(repo.assertCurrent(item.task, item.raw.id)).rejects.toThrow();
          await expect(repo.publish(item.task, item.raw.id, built, review)).rejects.toThrow();
          expect(await rows("packets")).toEqual([]);
          expect((await repo.list())[0]).toMatchObject({ state: "drafting", packetId: null });
        },
      );

      it("publishes recipe and critique binding and retains success without another draft", async () => {
        const item = await drafting();
        await repo.assertCurrent(item.task, item.raw.id);
        const built = await build(item);
        await expect(
          repo.publish(item.task, item.raw.id, built, { ...review, critiqueHash: "invalid" }),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        const packet = await repo.publish(item.task, item.raw.id, built, {
          ...review,
          repaired: true,
        });
        expect(await repo.get(packet.manifest.id)).toEqual(packet);
        expect((await repo.list())[0]).toMatchObject({
          state: "prepared",
          recipe: recipe(),
          packetSha256: digest(packet.manifest),
          critiqueSha256: review.critiqueHash,
          repaired: true,
        });
        expect(await repo.begin(item.task, item.raw.id)).toMatchObject({
          input: null,
          recipe: recipe(),
          packet,
        });
        expect((await rows("tasks")).filter((row) => row.type === "inspect")).toEqual([]);
        await repo.queueInspection(packet);
        await repo.queueInspection(packet);
        expect((await rows("tasks")).filter((row) => row.type === "inspect")).toHaveLength(1);
      });

      it("requires recipe-bound LLM evidence without reusing an identical baseline packet", async () => {
        const item = await drafting();
        const baseline = await repo.savePacket(await build(item, false));
        // Baseline persistence changes the application revision; enroll against that revision.
        await repo.failGeneration(item.task, item.raw.id, "MODEL_ROUTE_INELIGIBLE");
        await repo.complete(item.task);
        const revision = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            item.raw.applicationId,
          ])
        )[0];
        const raw = {
          ...item.raw,
          id: randomUUID(),
          expectedApplicationRevision: Number(revision?.revision),
        };
        await repo.create(raw);
        const task = await repo.claim("synthetic-generator", ["prepare"]);
        if (!task) throw new Error("Missing fresh generation task");
        const begun = await repo.begin(task, raw.id);
        if (!begun.input) throw new Error("Baseline must not be reused");
        const fresh = { ...item, raw, task, input: begun.input, recipe: begun.recipe };
        await expect(
          repo.publish(task, raw.id, await build(fresh, false), review),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        await expect(
          repo.publish(task, raw.id, await buildPacket(artifacts, begun.input), review),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        const built = await build(fresh);
        const saved = await repo.publish(task, raw.id, built, review);
        expect(saved.manifest.id).not.toBe(baseline.manifest.id);
        expect(saved.manifest.letterGeneration).toMatchObject({ method: "llm", recipe: recipe() });
        expect(saved.manifest.validation.status).toBe("valid");
        expect((await repo.list()).find((row) => row.id === raw.id)).toMatchObject({
          state: "prepared",
          packetId: saved.manifest.id,
          packetSha256: digest(saved.manifest),
          critiqueSha256: review.critiqueHash,
          repaired: false,
        });
        expect(await repo.begin(task, raw.id)).toMatchObject({ input: null, packet: saved });
        expect((await rows("tasks")).filter((row) => row.type === "inspect")).toEqual([]);
        await repo.queueInspection(saved);
        await repo.queueInspection(saved);
        expect((await rows("tasks")).filter((row) => row.type === "inspect")).toHaveLength(1);
      });

      it("rolls back real packet persistence, application changes and audits when the result update fails", async () => {
        const item = await drafting();
        const built = await build(item);
        const tables = [
          "packets",
          "packet_contents",
          "artifacts",
          "packet_validity",
          "applications",
          "audit_events",
          "outbox",
          "experiment_generations",
        ];
        const before = await Promise.all(
          tables.map((table) =>
            table === "packet_contents" || table === "packet_validity"
              ? db.query(`SELECT * FROM ${table} WHERE owner_id=$1 ORDER BY packet_id`, [owner])
              : rows(table),
          ),
        );
        let injected = false;
        const failing: Database = {
          ...db,
          transaction: (operation) =>
            db.transaction((tx) =>
              operation({
                dialect: tx.dialect,
                async query<T extends Row>(sql: string, values?: SqlValue[]): Promise<T[]> {
                  if (sql.startsWith("UPDATE experiment_generations SET state='prepared'")) {
                    injected = true;
                    throw new Error("synthetic result update failure");
                  }
                  return tx.query<T>(sql, values);
                },
              }),
            ),
        };
        await expect(
          new ExperimentGenerationRepository(failing, owner, clock).publish(
            item.task,
            item.raw.id,
            built,
            review,
          ),
        ).rejects.toThrow("synthetic result update failure");
        expect(injected).toBe(true);
        const after = await Promise.all(
          tables.map((table) =>
            table === "packet_contents" || table === "packet_validity"
              ? db.query(`SELECT * FROM ${table} WHERE owner_id=$1 ORDER BY packet_id`, [owner])
              : rows(table),
          ),
        );
        expect(after).toEqual(before);
        expect((await repo.publish(item.task, item.raw.id, built, review)).manifest.id).toBe(
          built.manifest.id,
        );
      });

      it("does not automatically regenerate interrupted drafting and keeps failed requests on submission hold", async () => {
        const item = await drafting();
        await expect(repo.begin(item.task, item.raw.id)).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        expect((await repo.list())[0]).toMatchObject({
          state: "failed",
          failureCode: "MODEL_ROUTE_INELIGIBLE",
        });
        await expect(guard(item.app.id, "unreviewed-packet")).rejects.toThrow();
        await repo.complete(item.task);
        expect(await repo.claim("synthetic-generator", ["prepare"])).toBeNull();
        expect(await rows("packets")).toEqual([]);
        expect((await repo.create(item.raw)).state).toBe("failed");
      });

      it("holds pending and prepared packets until exact review, then requires fresh inspection", async () => {
        const item = await drafting();
        await expect(guard(item.app.id, "unreviewed-packet")).rejects.toThrow();
        const packet = await repo.publish(item.task, item.raw.id, await build(item), review);
        await repo.complete(item.task);
        const browser = new BrowserRepository(db, owner, clock);
        await browser.save(readyResult(packet), {
          queueSubmit: { adapterId: "mock-ats", target: { fixture: "standard" } },
        });
        expect((await rows("tasks")).filter((row) => row.type === "submit")).toEqual([]);
        await expect(guard(item.app.id, packet.manifest.id)).rejects.toThrow();
        const assignment = {
          id: randomUUID(),
          experimentId: item.raw.experimentId,
          variantId: "concise",
          applicationId: item.app.id,
          packetId: packet.manifest.id,
          reviewedPacketSha256: digest(packet.manifest),
          reviewed: true,
        };
        await expect(
          experiments.assign({ ...assignment, variantId: "baseline" }),
        ).rejects.toThrow();
        await expect(
          experiments.assign({ ...assignment, reviewedPacketSha256: "0".repeat(64) }),
        ).rejects.toThrow();
        await experiments.assign(assignment);
        expect((await repo.list())[0]?.state).toBe("assigned");
        expect((await rows("applications"))[0]?.state).toBe("PREPARED");
        expect((await rows("tasks")).filter((row) => row.type === "inspect")).toHaveLength(1);
        await browser.save(readyResult(packet), {
          queueSubmit: { adapterId: "mock-ats", target: { fixture: "standard" } },
        });
        expect((await rows("applications"))[0]?.state).toBe("READY");
        expect((await rows("tasks")).filter((row) => row.type === "submit")).toHaveLength(1);
        await expect(guard(item.app.id, packet.manifest.id)).resolves.toMatchObject({
          assignmentId: assignment.id,
        });
      });

      it.each([
        { state: "queued", manual: false },
        { state: "queued", manual: true },
        { state: "assigned", manual: false },
        { state: "assigned", manual: true },
      ] as const)(
        "holds merged baseline with $state generation and manual assignment=$manual",
        async ({ state, manual }) => {
          const baseline = await application();
          const input = await repo.generationInput(
            baseline.app.id,
            baseline.assessment.id,
            [],
            "2026-09-17",
          );
          const packet = await repo.savePacket(await buildPacket(artifacts, input));
          const browser = new BrowserRepository(db, owner, clock);
          await browser.save(readyResult(packet));
          if (manual) {
            await experiments.assign({
              id: randomUUID(),
              experimentId: await experiment(),
              variantId: "baseline",
              applicationId: baseline.app.id,
              packetId: packet.manifest.id,
              reviewedPacketSha256: digest(packet.manifest),
              reviewed: true,
            });
          }
          now = new Date(now.getTime() + 1000);
          const generated = await request();
          await repo.create(generated.raw);
          if (state === "assigned") {
            const task = await repo.claim("synthetic-generator", ["prepare"]);
            if (!task) throw new Error("Expected generation lease");
            const begun = await repo.begin(task, generated.raw.id);
            if (!begun.input) throw new Error("Expected fresh input");
            const bound = { ...generated, task, input: begun.input, recipe: begun.recipe };
            const prepared = await repo.publish(task, generated.raw.id, await build(bound), review);
            await repo.complete(task);
            await browser.save(readyResult(prepared));
            await experiments.assign({
              id: randomUUID(),
              experimentId: generated.raw.experimentId,
              variantId: "concise",
              applicationId: generated.app.id,
              packetId: prepared.manifest.id,
              reviewedPacketSha256: digest(prepared.manifest),
              reviewed: true,
            });
          }
          await new DiscoveryRepository(db, owner, clock).mergeJobs(
            generated.jobId,
            baseline.jobId,
            "Synthetic equivalent requisitions",
          );
          const applications = await rows("applications");
          expect(applications.find((row) => row.id === generated.app.id)?.state).toBe("DUPLICATE");
          expect(applications.find((row) => row.id === baseline.app.id)?.state).toBe("READY");
          expect((await repo.get(packet.manifest.id)).valid).toBe(true);
          expect((await repo.list())[0]?.state).toBe(state);
          await expect(
            db.transaction((tx) => generationSubmissionHeld(tx, owner, baseline.app.id)),
          ).resolves.toBe(true);
          await expect(guard(baseline.app.id, packet.manifest.id)).rejects.toMatchObject({
            code: "POLICY_REVOKED",
          });
          await browser.save(readyResult(packet), {
            queueSubmit: { adapterId: "mock-ats", target: { fixture: "standard" } },
          });
          expect(
            (await rows("tasks")).filter(
              (row) => row.type === "submit" && row.application_id === baseline.app.id,
            ),
          ).toEqual([]);
        },
      );

      it.each(["answers", "authorization"])(
        "rejects %s changes after first preparation before assignment",
        async (change) => {
          const item = await drafting();
          const packet = await repo.publish(item.task, item.raw.id, await build(item), review);
          await repo.complete(item.task);
          await new BrowserRepository(db, owner, clock).save(readyResult(packet));
          const candidates = new CandidateRepository(db, owner, clock);
          if (change === "answers") {
            await candidates.saveAnswer({
              semanticKey: "sponsorship_required",
              meaning: "Sponsorship",
              answer: "no",
              validFrom: "2026-09-01",
              validUntil: "2026-10-01",
              employerIds: [documentJob.employerId],
              countries: ["NL"],
              evidenceFactIds: ["fact-work-nl"],
            });
          } else {
            await candidates.revokeAuthorization(documentAuthorization.id);
          }
          await expect(
            experiments.assign({
              id: randomUUID(),
              experimentId: item.raw.experimentId,
              variantId: "concise",
              applicationId: item.app.id,
              packetId: packet.manifest.id,
              reviewedPacketSha256: digest(packet.manifest),
              reviewed: true,
            }),
          ).rejects.toThrow();
          expect(await experiments.assignments(item.raw.experimentId)).toEqual([]);
          expect((await rows("tasks")).filter((row) => row.type === "submit")).toEqual([]);
          await expect(guard(item.app.id, packet.manifest.id)).rejects.toThrow();
        },
      );

      it("counts pending generation against manual assignment capacity", async () => {
        const experimentId = await experiment(2);
        const pending = await request(experimentId);
        await repo.create(pending.raw);
        await repo.create((await request(experimentId)).raw);
        const manual = await application();
        const input = await repo.generationInput(
          manual.app.id,
          manual.assessment.id,
          [],
          "2026-09-17",
        );
        const packet = await repo.savePacket(await buildPacket(artifacts, input));
        await new BrowserRepository(db, owner, clock).save(readyResult(packet));
        await expect(
          experiments.assign({
            id: randomUUID(),
            experimentId,
            variantId: "baseline",
            applicationId: manual.app.id,
            packetId: packet.manifest.id,
            reviewedPacketSha256: digest(packet.manifest),
            reviewed: true,
          }),
        ).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        expect(await experiments.assignments(experimentId)).toEqual([]);
        expect((await repo.list(experimentId))[0]?.state).toBe("queued");
      });

      it.each(["missing", "wrong"])(
        "rejects a recipe-bound packet with %s generation identity",
        async (identity) => {
          const item = await drafting();
          const content = generatePacketContent(item.input);
          const packet = await buildPacket(artifacts, item.input, {
            letter: content.letter,
            modelId: "synthetic/model:free",
            provider: "synthetic-provider",
            responseHash: "d".repeat(64),
            recipe: item.recipe,
            ...(identity === "wrong" ? { generationId: randomUUID() } : {}),
          });
          await expect(repo.publish(item.task, item.raw.id, packet, review)).rejects.toMatchObject({
            code: "CLAIM_UNSUPPORTED",
          });
          expect(await rows("packets")).toEqual([]);
          expect((await repo.list())[0]).toMatchObject({ state: "drafting", packetId: null });
        },
      );

      it("allows an explicit new request after failure while retaining the baseline hold", async () => {
        const item = await drafting();
        const baseline = await repo.savePacket(await build(item, false));
        await repo.failGeneration(item.task, item.raw.id, "MODEL_ROUTE_INELIGIBLE");
        await repo.complete(item.task);
        await expect(guard(item.app.id, baseline.manifest.id)).rejects.toThrow();
        expect(await repo.claim("no-auto-replay", ["prepare"])).toBeNull();
        const raw = {
          ...item.raw,
          id: randomUUID(),
          expectedApplicationRevision: Number((await rows("applications"))[0]?.revision),
        };
        expect((await repo.create(raw)).state).toBe("queued");
        expect(await repo.list()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: item.raw.id, state: "failed" }),
            expect.objectContaining({ id: raw.id, state: "queued" }),
          ]),
        );
        await expect(guard(item.app.id, baseline.manifest.id)).rejects.toThrow();
        expect((await rows("tasks")).filter((row) => row.type === "submit")).toEqual([]);
      });

      it("restore fails queued and drafting generations without replay and preserves completed evidence", async () => {
        const prepared = await drafting();
        const packet = await repo.publish(
          prepared.task,
          prepared.raw.id,
          await build(prepared),
          review,
        );
        await repo.complete(prepared.task);
        const preparedBefore = (await repo.list()).find((row) => row.id === prepared.raw.id);
        const draftingItem = await drafting();
        const queued = await request();
        await repo.create(queued.raw);
        const restore = new RestoreRepository(db, owner, clock);
        await restore.block("f".repeat(64));
        for (const id of [draftingItem.raw.id, queued.raw.id]) {
          expect((await repo.list()).find((row) => row.id === id)).toMatchObject({
            state: "failed",
            failureCode: "POLICY_REVOKED",
            packetId: null,
          });
        }
        expect((await repo.list()).find((row) => row.id === prepared.raw.id)).toEqual(
          preparedBefore,
        );
        expect(await repo.get(packet.manifest.id)).toEqual({
          ...packet,
          valid: false,
          invalidReason: "restore quarantine",
        });
        const tasks = await rows("tasks");
        expect(
          tasks.filter(
            (row) => row.type === "prepare" && ["ready", "leased"].includes(String(row.state)),
          ),
        ).toEqual([]);
        await expect(repo.assertCurrent(draftingItem.task, draftingItem.raw.id)).rejects.toThrow();
        for (const appId of [queued.app.id, draftingItem.app.id, prepared.app.id]) {
          await expect(guard(appId, packet.manifest.id)).rejects.toThrow();
        }
        expect(await repo.claim("restored-generator", ["prepare"])).toBeNull();
        expect((await repo.create(queued.raw)).state).toBe("failed");
        await restore.block("f".repeat(64));
        expect(await rows("tasks")).toEqual(tasks);
      });

      it("generates, inspects, exactly reviews and commits once through real synthetic workers", async () => {
        // Only Date is fixed: Chromium, server I/O and lease timers remain real.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now);
        try {
          const item = await request(undefined, "synthetic-engineer-1");
          const candidates = new CandidateRepository(db, owner, clock);
          const definitions = [
            {
              semanticKey: "country",
              meaning: "Country",
              answer: "NL",
              evidenceFactIds: ["fact-work-nl"],
            },
            {
              semanticKey: "sponsorship_required",
              meaning: "Will you need sponsorship in the future?",
              answer: "no",
              evidenceFactIds: ["fact-work-nl"],
            },
            {
              semanticKey: "available_from",
              meaning: "Available from",
              answer: "2026-11-01",
              evidenceFactIds: ["fact-availability"],
            },
            {
              semanticKey: "remote_preference",
              meaning: "Remote preference",
              answer: "yes",
              evidenceFactIds: ["fact-identity"],
            },
            {
              semanticKey: "terms",
              meaning: "I confirm these details are accurate",
              answer: true,
              evidenceFactIds: ["fact-identity"],
            },
          ];
          for (const definition of definitions) {
            await candidates.saveAnswer({
              ...definition,
              validFrom: "2026-09-01",
              validUntil: "2026-10-01",
              countries: ["NL"],
              employerIds: [documentJob.employerId],
            });
            await candidates.resolveQuestion(
              item.app.id,
              definition.semanticKey,
              definition.meaning,
            );
          }
          const answers = await rows("approved_answers");
          const content = generatePacketContent(
            await repo.generationInput(item.app.id, item.assessment.id, [], "2026-09-17"),
          );
          const responses = [
            JSON.stringify({
              opening: content.letter.opening,
              motivation: "The role's focus on Python makes this opportunity compelling.",
              contributionIds: content.letter.contributions.map((claim) => claim.id).slice(0, 2),
            }),
            JSON.stringify({ issues: [] }),
          ];
          const transport = {
            complete: vi.fn(async () => {
              const response = responses.shift();
              if (!response) throw new Error("Unexpected synthetic inference request");
              return {
                model: "synthetic/model:free",
                provider: "synthetic-provider",
                content: response,
                usage: { promptTokens: 10, completionTokens: 2 },
              };
            }),
          };
          const ledger = new MatchingRepository(db, owner, clock);
          await ledger.setRoute(syntheticCatalogue("synthetic/model:free"), {
            eligible: true,
            modelId: "synthetic/model:free",
            provider: "synthetic-provider",
            reasons: [],
            catalogueFetchedAt: now.toISOString(),
          });
          await repo.setControl({ submissionsPaused: false });
          await repo.create(item.raw);
          const generation = await repo.claim("synthetic-generator", ["prepare"]);
          if (!generation) throw new Error("Expected generation task");
          const packet = await runVariantPreparation(generation, {
            repository: repo,
            artifacts,
            runner: new LetterDraftRunner(ledger, 50, transport),
            limits: { requests: 2, tokens: 8000, wallTimeMs: 20000 },
          });
          await repo.complete(generation);
          expect(transport.complete).toHaveBeenCalledTimes(2);
          expect(packet.manifest.letterGeneration).toMatchObject({
            method: "llm",
            recipe: recipe(),
            generationId: item.raw.id,
          });
          expect(packet.manifest.validation.status).toBe("valid");
          const cv = await repo.artifact(packet.manifest.id, "cv_pdf", artifacts);
          expect(cv.buffer.subarray(0, 5).toString()).toBe("%PDF-");
          const adapters = createAdapterRegistry(dir);
          const adapter = adapters.get("mock-ats");
          const browser = new BrowserRepository(db, owner, clock);
          const inspect = async () => {
            const task = await repo.claim("synthetic-inspector", ["inspect"]);
            if (!task) throw new Error("Expected actual inspection task");
            await runInspectionTask(task, {
              config: { profile: "demo", externalSubmissionEnabled: false },
              repository: repo,
              documents: repo,
              browser,
              artifacts,
              adapters,
              clock,
            });
            await repo.complete(task);
            const preparation = (await browser.snapshot())[0];
            if (!preparation) throw new Error("Expected browser preparation");
            expect(preparation.result.status, JSON.stringify(preparation.result.issues)).toBe(
              "ready",
            );
            expect(preparation.result.reports).toHaveLength(2);
            expect(
              preparation.result.reports.every((report) =>
                report.readBack.every((row) => row.matches),
              ),
            ).toBe(true);
            expect(preparation.result.serverApplicationCount).toBe(0);
            return preparation;
          };
          const first = await inspect();
          expect((await rows("tasks")).filter((row) => row.type === "submit")).toEqual([]);
          expect(await rows("attempts")).toEqual([]);
          await expect(guard(item.app.id, packet.manifest.id)).rejects.toThrow();
          const assignment = {
            id: randomUUID(),
            experimentId: item.raw.experimentId,
            variantId: "concise",
            applicationId: item.app.id,
            packetId: packet.manifest.id,
            reviewedPacketSha256: digest(packet.manifest),
            reviewed: true,
          };
          await expect(
            experiments.assign({ ...assignment, reviewedPacketSha256: "0".repeat(64) }),
          ).rejects.toThrow();
          await experiments.assign(assignment);
          expect((await rows("applications"))[0]?.state).toBe("PREPARED");
          expect((await rows("tasks")).filter((row) => row.type === "submit")).toEqual([]);
          now = new Date(now.getTime() + 1000);
          vi.setSystemTime(now);
          const fresh = await inspect();
          expect(fresh.id).not.toBe(first.id);
          expect(await rows("approved_answers")).toEqual(answers);
          expect((await rows("tasks")).filter((row) => row.type === "submit")).toHaveLength(1);
          const task = await repo.claim("synthetic-submitter", ["submit"]);
          if (!task) throw new Error("Expected guarded submit task");
          const submissions = new SubmissionRepository(db, owner, clock);
          const handle = await submissions.begin(task, {
            packetId: packet.manifest.id,
            preparationId: fresh.id,
            expectedRevision: Number((await rows("applications"))[0]?.revision),
          });
          const authorizeDispatch = vi.fn(() => submissions.authorizeDispatch(task, handle));
          const outcome = await adapter.commit({
            packet,
            cvPdf: cv.buffer,
            preparation: fresh,
            target: { fixture: "standard" },
            validateAnswers: (snapshot, plan) =>
              candidates.validateFormPlan(packet, snapshot, plan, handle),
            authorizeDispatch,
          });
          expect(authorizeDispatch).toHaveBeenCalledOnce();
          if (outcome.status !== "confirmed") throw new Error("Expected actual MockATS receipt");
          expect(outcome.evidence.kind).toBe("mock_ats");
          const receiptId = await submissions.confirmReceipt(task, handle, outcome.evidence);
          await repo.complete(task);
          expect((await rows("applications"))[0]?.state).toBe("CONFIRMED");
          expect(await rows("attempts")).toHaveLength(1);
          expect(await rows("receipts")).toEqual([expect.objectContaining({ id: receiptId })]);
          expect(await repo.claim("synthetic-submit-retry", ["submit"])).toBeNull();
          const mock = await startMockAts(join(dir, "mock-ats-records"));
          try {
            const records = (await mock.app.inject({ url: "/__test/records" })).json();
            expect(records.count).toBe(1);
            expect(records.records[0]).toMatchObject({ jobId: item.jobId, fixture: "standard" });
          } finally {
            await mock.app.close();
          }
          expect((await repo.summary("demo")).daily.cohorts.synthetic.confirmedApplications).toBe(
            1,
          );
          expect((await repo.summary("demo")).daily.cohorts.live.confirmedApplications).toBe(0);
        } finally {
          vi.useRealTimers();
        }
      }, 60000);
    },
  );
}
