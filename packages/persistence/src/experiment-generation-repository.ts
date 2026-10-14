import { packetRequestedAnswerSchema } from "../../contracts/src/documents.js";
import {
  experimentGenerationInputSchema,
  experimentGenerationTaskSchema,
  experimentGenerationViewSchema,
} from "../../contracts/src/experiment-generation.js";
import {
  DomainError,
  type ErrorCode,
  errorCodeSchema,
  type Task,
} from "../../contracts/src/index.js";
import type { BuiltPacket } from "../../documents/src/factory.js";
import { assertLetterVariantRecipe } from "../../documents/src/letter-variants.js";
import { localDay } from "../../domain/src/state.js";
import type { Row, SqlExecutor } from "./database.js";
import { DocumentRepository } from "./document-repository.js";
import {
  assertGenerationSources,
  type GenerationBinding as Binding,
  generationBinding as binding,
  generationBindingSchema as bindingSchema,
  generationHash as hash,
} from "./experiment-generation-binding.js";
import { activeExperimentDefinition } from "./experiment-repository.js";
import { jobIdentity } from "./job-identity.js";

function view(row: Row) {
  const data = binding(row);
  return experimentGenerationViewSchema.parse({
    id: data.request.id,
    experimentId: data.request.experimentId,
    variantId: data.request.variantId,
    applicationId: data.request.applicationId,
    assessmentId: data.request.assessmentId,
    recipe: data.recipe,
    state: row.state,
    packetId: row.packet_id,
    packetSha256: row.packet_sha256,
    critiqueSha256: row.critique_sha256,
    repaired: row.repaired === null ? null : row.repaired === 1,
    failureCode: row.failure_code,
    createdAt: data.createdAt,
  });
}

export class ExperimentGenerationRepository extends DocumentRepository {
  private async row(tx: SqlExecutor, id: string) {
    const row = (
      await tx.query("SELECT * FROM experiment_generations WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        id,
      ])
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Experiment generation not found.");
    binding(row);
    return row;
  }
  private async answerHash(tx: SqlExecutor) {
    const rows = await tx.query(
      "SELECT id,revision,data FROM approved_answers WHERE owner_id=$1 ORDER BY id LIMIT 2001",
      [this.ownerId],
    );
    if (rows.length > 2000)
      throw new DomainError("STATE_INVALID", "Answer inventory exceeds its bound.");
    return hash(rows);
  }
  private async questions(applicationId: string) {
    const rows = await this.db.query(
      "SELECT semantic_key,meaning,country FROM question_blocks WHERE owner_id=$1 AND application_id=$2 ORDER BY semantic_key LIMIT 101",
      [this.ownerId, applicationId],
    );
    if (rows.length > 100)
      throw new DomainError("STATE_INVALID", "Generation questions exceed their bound.");
    return rows
      .filter((row) => /^[A-Z]{2}$/.test(String(row.country)))
      .map((row) =>
        packetRequestedAnswerSchema.parse({
          semanticKey: String(row.semantic_key),
          meaning: String(row.meaning),
          country: String(row.country),
          maxCharacters: null,
        }),
      );
  }
  private async input(data: Binding) {
    const input = await this.generationInput(
      data.request.applicationId,
      data.request.assessmentId,
      data.requestedAnswers,
      localDay(this.clock()),
    );
    input.generatedAt = data.createdAt;
    input.approvedAnswers.sort((a, b) => a.id.localeCompare(b.id));
    if (hash(input) !== data.inputSha256)
      throw new DomainError("PROFILE_STALE", "Generation inputs changed after enrollment.");
    return input;
  }
  private async available(tx: SqlExecutor, applicationId: string, excludeId?: string) {
    const app = (
      await tx.query("SELECT * FROM applications WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        applicationId,
      ])
    )[0];
    if (!app) throw new DomainError("NOT_FOUND", "Generation application not found.");
    const identity = await jobIdentity(tx, this.ownerId, String(app.job_id));
    for (const member of identity.members) {
      for (const table of ["intents", "attempts", "outcome_events"] as const) {
        if (
          (
            await tx.query(
              `SELECT x.id FROM ${table} x JOIN applications a ON a.owner_id=x.owner_id AND a.id=x.application_id WHERE x.owner_id=$1 AND a.job_id=$2 LIMIT 1`,
              [this.ownerId, member],
            )
          ).length
        )
          throw new DomainError(
            "DUPLICATE_SUSPECTED",
            "Generation must precede all intent and outcome evidence.",
          );
      }
      if (
        (
          await tx.query(
            "SELECT id FROM experiment_assignments WHERE owner_id=$1 AND canonical_job_id=$2 LIMIT 1",
            [this.ownerId, member],
          )
        ).length ||
        (
          await tx.query(
            "SELECT id FROM experiment_generations WHERE owner_id=$1 AND canonical_job_id=$2 AND state<>'failed' AND id<>$3 LIMIT 1",
            [this.ownerId, member, excludeId ?? ""],
          )
        ).length
      )
        throw new DomainError(
          "DUPLICATE_SUSPECTED",
          "Equivalent job already has an experiment enrollment.",
        );
    }
    return { app, identity };
  }
  private async check(tx: SqlExecutor, row: Row, task?: Task) {
    const data = binding(row);
    if (task) {
      await this.validLease(tx, task);
      const payload = experimentGenerationTaskSchema.parse(task.payload);
      if (
        task.type !== "prepare" ||
        task.id !== row.task_id ||
        task.applicationId !== row.application_id ||
        payload.generationId !== row.id ||
        payload.assessmentId !== data.request.assessmentId
      )
        throw new DomainError("LEASE_STALE", "Generation task binding changed.");
    }
    const controls = await this.readControl(tx);
    if (controls.stopped || controls.preparationPaused || controls.restoreBlocked)
      throw new DomainError("POLICY_REVOKED", "Generation is paused by current controls.");
    const experiment = (
      await tx.query("SELECT * FROM experiments WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        data.request.experimentId,
      ])
    )[0];
    if (!experiment) throw new DomainError("NOT_FOUND", "Generation experiment is missing.");
    const definition = activeExperimentDefinition(experiment, this.now());
    if (
      experiment.sha256 !== data.experimentSha256 ||
      Number(experiment.revision) !== data.request.expectedExperimentRevision ||
      !definition.variants.some(
        (v) =>
          v.id === data.request.variantId &&
          JSON.stringify(v.generationRecipe) === JSON.stringify(data.recipe),
      )
    )
      throw new DomainError("POLICY_REVOKED", "Generation experiment approval changed.");
    const { app, identity } = await this.available(tx, data.request.applicationId, String(row.id));
    if (
      identity.canonical !== data.canonicalJobId ||
      Number(app.revision) !== data.request.expectedApplicationRevision ||
      !["ELIGIBLE", "PREPARING", "PREPARED", "NEEDS_INPUT"].includes(String(app.state))
    )
      throw new DomainError("REVISION_STALE", "Generation application changed.");
    await assertGenerationSources(tx, this.ownerId, data, this.now());
    return data;
  }
  async create(raw: unknown) {
    const request = experimentGenerationInputSchema.parse(raw);
    const prior = (
      await this.db.query("SELECT * FROM experiment_generations WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        request.id,
      ])
    )[0];
    if (prior) {
      if (JSON.stringify(binding(prior).request) !== JSON.stringify(request))
        throw new DomainError("REVISION_STALE", "Generation ID cannot be redefined.");
      return view(prior);
    }
    const requestedAnswers = await this.questions(request.applicationId);
    const beforeInput = await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = (
        await tx.query("SELECT revision FROM candidates WHERE owner_id=$1", [this.ownerId])
      )[0];
      return {
        candidateRevision: Number(candidate?.revision),
        answersSha256: await this.answerHash(tx),
      };
    });
    const input = await this.generationInput(
      request.applicationId,
      request.assessmentId,
      requestedAnswers,
      localDay(this.clock()),
    );
    const createdAt = this.now();
    input.generatedAt = createdAt;
    input.approvedAnswers.sort((a, b) => a.id.localeCompare(b.id));
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const replay = (
        await tx.query("SELECT * FROM experiment_generations WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          request.id,
        ])
      )[0];
      if (replay) {
        if (JSON.stringify(binding(replay).request) !== JSON.stringify(request))
          throw new DomainError("REVISION_STALE", "Generation ID cannot be redefined.");
        return view(replay);
      }
      const experiment = (
        await tx.query("SELECT * FROM experiments WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          request.experimentId,
        ])
      )[0];
      if (!experiment) throw new DomainError("NOT_FOUND", "Experiment not found.");
      const definition = activeExperimentDefinition(experiment, this.now());
      const variant = definition.variants.find(
        (v) => v.id === request.variantId && v.kind === "wording",
      );
      if (!variant?.generationRecipe)
        throw new DomainError("POLICY_REVOKED", "Variant has no approved automatic recipe.");
      assertLetterVariantRecipe(variant.generationRecipe);
      await tx.query(
        "UPDATE experiment_generations SET state='failed',failure_code='PROFILE_STALE',completed_at=$1 WHERE owner_id=$2 AND application_id=$3 AND state='prepared' AND EXISTS(SELECT 1 FROM packet_validity v WHERE v.owner_id=experiment_generations.owner_id AND v.packet_id=experiment_generations.packet_id)",
        [this.now(), this.ownerId, request.applicationId],
      );
      const { identity } = await this.available(tx, request.applicationId);
      const count = (
        await tx.query(
          "SELECT (SELECT COUNT(*) FROM experiment_assignments WHERE owner_id=$1 AND experiment_id=$2) + (SELECT COUNT(*) FROM experiment_generations WHERE owner_id=$1 AND experiment_id=$2 AND state IN ('queued','drafting','prepared')) AS total",
          [this.ownerId, request.experimentId],
        )
      )[0];
      if (Number(count?.total) >= definition.maximumAssignments)
        throw new DomainError("POLICY_REVOKED", "Experiment enrollment limit reached.");
      if (
        (
          await tx.query(
            "SELECT id FROM tasks WHERE owner_id=$1 AND application_id=$2 AND state='leased' LIMIT 1",
            [this.ownerId, request.applicationId],
          )
        ).length
      )
        throw new DomainError("LEASE_STALE", "Application already has active work.");
      const auth = (
        await tx.query("SELECT data FROM authorizations WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          input.authorization.id,
        ])
      )[0];
      const assessment = (
        await tx.query("SELECT data FROM match_assessments WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          request.assessmentId,
        ])
      )[0];
      const job = (
        await tx.query("SELECT data FROM jobs WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          input.job.id,
        ])
      )[0];
      const data = bindingSchema.parse({
        request,
        recipe: variant.generationRecipe,
        experimentSha256: experiment.sha256,
        canonicalJobId: identity.canonical,
        candidateRevision: beforeInput.candidateRevision,
        profileId: input.profile.id,
        authorizationId: input.authorization.id,
        authorizationRevision: input.authorization.revision,
        authorizationSha256: hash(String(auth?.data)),
        assessmentSha256: hash(String(assessment?.data)),
        jobSha256: hash(String(job?.data)),
        answersSha256: beforeInput.answersSha256,
        inputSha256: hash(input),
        requestedAnswers,
        createdAt,
      });
      const temporary: Row = {
        id: request.id,
        application_id: request.applicationId,
        experiment_id: request.experimentId,
        canonical_job_id: identity.canonical,
        data: JSON.stringify(data),
        sha256: hash(data),
      };
      await this.check(tx, temporary);
      await tx.query(
        "INSERT INTO packet_validity(owner_id,packet_id,invalidated_at,reason) SELECT owner_id,id,$1,'ARTIFACT_CHANGED' FROM packets WHERE owner_id=$2 AND application_id=$3 ON CONFLICT(owner_id,packet_id) DO NOTHING",
        [this.now(), this.ownerId, request.applicationId],
      );
      const task = await this.enqueueIn(tx, {
        type: "prepare",
        domain: "documents",
        applicationId: request.applicationId,
        dedupeKey: `prepare:variant:${request.id}`,
        priority: 50,
        maxAttempts: 2,
        payload: { schemaVersion: 1, generationId: request.id, assessmentId: request.assessmentId },
      });
      await tx.query(
        "INSERT INTO experiment_generations(owner_id,id,experiment_id,application_id,canonical_job_id,data,sha256,state,task_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9)",
        [
          this.ownerId,
          request.id,
          request.experimentId,
          request.applicationId,
          identity.canonical,
          JSON.stringify(data),
          hash(data),
          task.id,
          createdAt,
        ],
      );
      await this.audit(
        tx,
        request.id,
        "experiment.generation_requested",
        1,
        { experimentId: request.experimentId, variantId: request.variantId },
        "owner",
      );
      return view(await this.row(tx, request.id));
    });
  }
  async list(experimentId?: string) {
    const rows = await this.db.query(
      `SELECT * FROM experiment_generations WHERE owner_id=$1${experimentId ? " AND experiment_id=$2" : ""} ORDER BY created_at DESC,id LIMIT 1001`,
      experimentId ? [this.ownerId, experimentId] : [this.ownerId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Generation catalog exceeds its bound.");
    return rows.map(view);
  }
  async eligibleApplications() {
    const rows = await this.db.query(
      "SELECT a.id,a.revision,a.state,m.id AS assessment_id,j.data FROM applications a JOIN candidates c ON c.owner_id=a.owner_id JOIN match_assessments m ON m.owner_id=a.owner_id AND m.application_id=a.id AND m.profile_id=c.active_profile_id JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE a.owner_id=$1 AND a.state IN ('ELIGIBLE','PREPARING','PREPARED','NEEDS_INPUT') AND NOT EXISTS(SELECT 1 FROM experiment_generations g WHERE g.owner_id=a.owner_id AND g.application_id=a.id AND g.state<>'failed' AND NOT(g.state='prepared' AND EXISTS(SELECT 1 FROM packet_validity v WHERE v.owner_id=g.owner_id AND v.packet_id=g.packet_id))) ORDER BY m.created_at DESC,m.id DESC LIMIT 1001",
      [this.ownerId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Eligible generation inventory exceeds its bound.");
    const seen = new Set<string>();
    return rows
      .filter((row) => {
        const id = String(row.id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((row) => {
        const job = JSON.parse(String(row.data));
        return {
          applicationId: String(row.id),
          revision: Number(row.revision),
          assessmentId: String(row.assessment_id),
          company: String(job.company),
          title: String(job.title),
          state: String(row.state),
        };
      });
  }
  async begin(task: Task, id: string) {
    const row = await this.row(this.db, id);
    const data = binding(row);
    if (["prepared", "assigned"].includes(String(row.state))) {
      await this.db.transaction(async (tx) => {
        await this.lockOwner(tx);
        await this.validLease(tx, task);
        if (task.id !== row.task_id)
          throw new DomainError("LEASE_STALE", "Generation task changed.");
      });
      const packet = await this.get(String(row.packet_id));
      if (!packet.valid || hash(packet.manifest) !== row.packet_sha256)
        throw new DomainError("PROFILE_STALE", "Generated packet is no longer valid.");
      return { input: null, recipe: data.recipe, packet };
    }
    if (row.state === "drafting") {
      await this.failGeneration(task, id, "MODEL_ROUTE_INELIGIBLE");
      throw new DomainError(
        "STATE_INVALID",
        "Interrupted drafting requires a fresh reviewed request.",
      );
    }
    if (row.state !== "queued") throw new DomainError("STATE_INVALID", "Generation is not queued.");
    const input = await this.input(data);
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const current = await this.row(tx, id);
      if (current.state !== "queued")
        throw new DomainError("REVISION_STALE", "Generation already started.");
      await this.check(tx, current, task);
      await tx.query(
        "UPDATE experiment_generations SET state='drafting',fence=$1 WHERE owner_id=$2 AND id=$3",
        [task.fence, this.ownerId, id],
      );
    });
    return { input, recipe: data.recipe, packet: null };
  }
  async assertCurrent(task: Task, id: string) {
    const row = await this.row(this.db, id);
    await this.input(binding(row));
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const current = await this.row(tx, id);
      if (current.state !== "drafting" || Number(current.fence) !== task.fence)
        throw new DomainError("LEASE_STALE", "Generation fence changed.");
      await this.check(tx, current, task);
    });
  }
  async publish(
    task: Task,
    id: string,
    packet: BuiltPacket,
    review: { critiqueHash: string; repaired: boolean },
  ) {
    const existing = await this.row(this.db, id);
    await this.input(binding(existing));
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = await this.row(tx, id);
      if (row.state !== "drafting" || Number(row.fence) !== task.fence)
        throw new DomainError("LEASE_STALE", "Generation publication fence changed.");
      const data = await this.check(tx, row, task);
      if (
        !/^[a-f0-9]{64}$/.test(review.critiqueHash) ||
        typeof review.repaired !== "boolean" ||
        packet.manifest.applicationId !== data.request.applicationId ||
        packet.manifest.assessmentId !== data.request.assessmentId ||
        packet.manifest.validation.status !== "valid" ||
        packet.manifest.letterGeneration?.method !== "llm" ||
        packet.manifest.letterGeneration.generationId !== id ||
        JSON.stringify(packet.manifest.letterGeneration.recipe) !== JSON.stringify(data.recipe)
      )
        throw new DomainError(
          "CLAIM_UNSUPPORTED",
          "Generation requires its validated recipe-bound reviewed letter.",
        );
      const saved = await this.savePacketIn(tx, packet);
      await tx.query(
        "UPDATE experiment_generations SET state='prepared',packet_id=$1,packet_sha256=$2,critique_sha256=$3,repaired=$4,completed_at=$5 WHERE owner_id=$6 AND id=$7",
        [
          saved.manifest.id,
          hash(saved.manifest),
          review.critiqueHash,
          review.repaired ? 1 : 0,
          this.now(),
          this.ownerId,
          id,
        ],
      );
      await this.audit(tx, id, "experiment.generation_prepared", 1, {
        packetId: saved.manifest.id,
      });
      return saved;
    });
  }
  async failGeneration(task: Task, id: string, code: ErrorCode) {
    errorCodeSchema.parse(code);
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.validLease(tx, task);
      const row = await this.row(tx, id);
      if (task.id !== row.task_id || !["queued", "drafting"].includes(String(row.state))) return;
      await tx.query(
        "UPDATE experiment_generations SET state='failed',failure_code=$1,completed_at=$2 WHERE owner_id=$3 AND id=$4",
        [code, this.now(), this.ownerId, id],
      );
      await this.audit(tx, id, "experiment.generation_failed", 1, { code });
    });
  }
}
