import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packetManifestSchema } from "../../packages/contracts/src/documents.js";
import { experimentInputSchema } from "../../packages/contracts/src/experiment.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import {
  assertExperimentDispatch,
  ExperimentRepository,
} from "../../packages/persistence/src/experiment-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { OutcomeRepository } from "../../packages/persistence/src/outcome-repository.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { documentJob } from "../fixtures/document-packets.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} controlled experiments`,
    () => {
      let db: Database;
      let owner: string;
      let now: Date;
      let repo: Repository;
      let experiments: ExperimentRepository;
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `experiments-${randomUUID()}`;
        now = new Date("2026-09-17T09:00:00.000Z");
        repo = new Repository(db, owner, () => now);
        await repo.initialize();
        experiments = new ExperimentRepository(db, owner, () => now);
      });
      afterEach(async () => {
        await db?.close();
      });
      const definition = () => ({
        id: randomUUID(),
        metric: "INTERVIEW",
        observationDays: 30,
        expiresAt: "2026-10-17T09:00:00.000Z",
        maximumAssignments: 2,
        variants: [
          { id: "baseline", kind: "wording", approvalSha256: "a".repeat(64) },
          { id: "concise", kind: "wording", approvalSha256: "b".repeat(64) },
        ],
      });
      // Minimal manifest fixture, not an executable or live document packet.
      const ready = async () => {
        const jobId = randomUUID();
        await repo.putJob({ ...documentJob, id: jobId, requisitionId: jobId });
        const app = await repo.createApplication(jobId, "synthetic-candidate");
        await db.query("UPDATE applications SET state='READY' WHERE owner_id=$1 AND id=$2", [
          owner,
          app.id,
        ]);
        const id = randomUUID();
        const manifest = packetManifestSchema.parse({
          schemaVersion: 1,
          id,
          applicationId: app.id,
          jobId,
          profileId: "synthetic-profile",
          profileRevision: 1,
          assessmentId: "synthetic-assessment",
          authorizationId: "synthetic-authorization",
          authorizationRevision: 1,
          contentSha256: "a".repeat(64),
          templateVersions: { cv: "cv-v1", letter: "letter-v1" },
          artifacts: ["cv_docx", "cv_pdf", "letter_docx", "letter_pdf", "answers_json"].map(
            (kind) => ({
              id: `artifact-${kind}`,
              kind,
              sha256: "a".repeat(64),
              mimeType: "application/pdf",
              bytes: 1,
              storageKey: `sha256/aa/${"a".repeat(64)}`,
              filename: `${kind}.pdf`,
            }),
          ),
          validation: {
            validatorVersion: "packet-validator-v1",
            status: "valid",
            issues: [],
            checkedClaimIds: [],
            checkedAt: now.toISOString(),
          },
          createdAt: now.toISOString(),
        });
        const data = JSON.stringify(manifest);
        const sha = createHash("sha256").update(data).digest("hex");
        await db.query(
          "INSERT INTO packets(owner_id,id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [owner, id, app.id, data, sha, now.toISOString()],
        );
        return {
          app,
          jobId,
          manifest,
          input: {
            id: randomUUID(),
            applicationId: app.id,
            packetId: id,
            reviewedPacketSha256: sha,
            reviewed: true,
            variantId: "baseline",
          },
        };
      };
      const guard = (applicationId: string, packetId: string) =>
        db.transaction((tx) =>
          assertExperimentDispatch(tx, owner, applicationId, packetId, now.toISOString()),
        );

      it("freezes definitions, exact retries and owner isolation without modifying policy", async () => {
        const input = definition();
        const controls = await repo.getControl();
        expect(await experiments.create(input)).toMatchObject({ revision: 1, state: "active" });
        expect(await experiments.create(input)).toMatchObject({ revision: 1 });
        await expect(experiments.create({ ...input, metric: "OFFER" })).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
        await expect(
          experiments.create({ ...definition(), expiresAt: now.toISOString() }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        expect(
          experimentInputSchema.safeParse({
            ...input,
            variants: [input.variants[0], input.variants[0]],
          }).success,
        ).toBe(false);
        expect(experimentInputSchema.safeParse({ ...input, policy: {} }).success).toBe(false);
        const other = new ExperimentRepository(db, `other-${randomUUID()}`, () => now);
        await new Repository(db, other.ownerId).initialize();
        expect(await other.list()).toEqual([]);
        await expect(other.stop(input.id, { expectedRevision: 1 })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(experiments.stop(input.id, { expectedRevision: 2 })).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
        await experiments.stop(input.id, { expectedRevision: 1 });
        expect(await experiments.stop(input.id, { expectedRevision: 1 })).toMatchObject({
          revision: 2,
        });
        expect(await experiments.create(input)).toMatchObject({ state: "stopped" });
        expect(await repo.getControl()).toEqual(controls);
        expect(
          (
            await db.query(
              "SELECT id FROM audit_events WHERE owner_id=$1 AND action='experiment.stopped'",
              [owner],
            )
          ).length,
        ).toBe(1);
      });
      it("binds one reviewed variant, refuses duplicate or known-outcome jobs and caps assignments", async () => {
        const input = definition();
        await experiments.create(input);
        const first = await ready();
        const assignment = { ...first.input, experimentId: input.id };
        const result = await experiments.assign(assignment);
        expect(await experiments.assign(assignment)).toEqual(result);
        await expect(
          experiments.assign({ ...assignment, variantId: "concise" }),
        ).rejects.toMatchObject({ code: "REVISION_STALE" });
        await expect(
          experiments.assign({ ...assignment, id: randomUUID(), variantId: "concise" }),
        ).rejects.toMatchObject({ code: "DUPLICATE_SUSPECTED" });
        const known = await ready();
        await new OutcomeRepository(db, owner, () => now).recordOwner({
          applicationId: known.app.id,
          kind: "UNKNOWN",
          expectedRevision: 0,
          requestId: randomUUID(),
          evidenceRef: "synthetic-review",
          evidenceSha256: "b".repeat(64),
          occurredAt: now.toISOString(),
        });
        await expect(
          experiments.assign({ ...known.input, experimentId: input.id }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        const second = await ready();
        await experiments.assign({ ...second.input, experimentId: input.id, variantId: "concise" });
        const third = await ready();
        await expect(
          experiments.assign({ ...third.input, experimentId: input.id }),
        ).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        expect((await experiments.assignments(input.id)).length).toBe(2);
        expect(
          (await db.query("SELECT id FROM applications WHERE owner_id=$1", [owner])).length,
        ).toBe(4);
        expect(await guard(first.app.id, first.input.packetId)).toMatchObject({
          assignmentId: assignment.id,
        });
      });
      it("refuses changed, invalidated and unapproved packets before any intent", async () => {
        const input = definition();
        await experiments.create(input);
        const item = await ready();
        const assignment = { ...item.input, experimentId: input.id };
        await expect(experiments.assign({ ...assignment, reviewed: false })).rejects.toThrow();
        await expect(
          experiments.assign({ ...assignment, variantId: "unknown" }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        await expect(
          experiments.assign({ ...assignment, reviewedPacketSha256: "f".repeat(64) }),
        ).rejects.toMatchObject({ code: "PROFILE_STALE" });
        await db.query(
          "INSERT INTO packet_validity(owner_id,packet_id,invalidated_at,reason) VALUES($1,$2,$3,'synthetic-change')",
          [owner, item.input.packetId, now.toISOString()],
        );
        await expect(experiments.assign(assignment)).rejects.toMatchObject({
          code: "PROFILE_STALE",
        });
        expect(await experiments.packets()).toEqual([]);
        expect(await db.query("SELECT id FROM intents WHERE owner_id=$1", [owner])).toEqual([]);
      });
      it("detects packet/assignment tampering and identity merges; stopping preserves assignment", async () => {
        const input = definition();
        await experiments.create(input);
        const first = await ready();
        const second = await ready();
        await experiments.assign({ ...first.input, experimentId: input.id });
        await experiments.assign({ ...second.input, experimentId: input.id, variantId: "concise" });
        await db.query(
          "INSERT INTO identity_resolutions(id,owner_id,from_job_id,to_job_id,reason,created_at) VALUES($1,$2,$3,$4,'synthetic-equivalence',$5)",
          [randomUUID(), owner, first.jobId, second.jobId, now.toISOString()],
        );
        await expect(guard(first.app.id, first.input.packetId)).rejects.toMatchObject({
          code: "DUPLICATE_SUSPECTED",
        });
        await experiments.stop(input.id, { expectedRevision: 1 });
        await expect(guard(second.app.id, second.input.packetId)).rejects.toMatchObject({
          code: "POLICY_REVOKED",
        });
        expect((await experiments.assignments(input.id)).length).toBe(2);
        await db.query(
          "UPDATE experiment_assignments SET binding='{}' WHERE owner_id=$1 AND id=$2",
          [owner, first.input.id],
        );
        await expect(experiments.assignments(input.id)).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        await expect(
          experiments.assign({ ...first.input, experimentId: input.id }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        await db.query("UPDATE experiments SET data='{}' WHERE owner_id=$1 AND id=$2", [
          owner,
          input.id,
        ]);
        await expect(experiments.list()).rejects.toMatchObject({ code: "STATE_INVALID" });
      });
    },
  );
}
