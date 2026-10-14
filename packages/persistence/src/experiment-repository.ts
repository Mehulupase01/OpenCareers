import { createHash, randomUUID } from "node:crypto";
import { packetManifestSchema } from "../../contracts/src/documents.js";
import {
  experimentAssignmentSchema,
  experimentInputSchema,
  experimentStopSchema,
} from "../../contracts/src/experiment.js";
import { DomainError } from "../../contracts/src/index.js";
import { assertLetterVariantRecipe } from "../../documents/src/letter-variants.js";
import type { SqlExecutor } from "./database.js";
import {
  assertGenerationSources,
  generationBinding,
  generationSubmissionHeld,
} from "./experiment-generation-binding.js";
import { jobIdentity } from "./job-identity.js";
import { OwnerScope } from "./owner-scope.js";

const hash = (data: string) => createHash("sha256").update(data).digest("hex");
type Row = Record<string, unknown>;
function assignmentData(row: Row) {
  if (hash(String(row.binding)) !== row.binding_sha256)
    throw new DomainError("STATE_INVALID", "Assignment evidence integrity failed.");
  const data = experimentAssignmentSchema.parse(JSON.parse(String(row.binding)));
  if (
    data.id !== row.id ||
    data.experimentId !== row.experiment_id ||
    data.applicationId !== row.application_id ||
    data.packetId !== row.packet_id ||
    data.variantId !== row.variant_id ||
    data.reviewedPacketSha256 !== row.packet_sha256
  )
    throw new DomainError("STATE_INVALID", "Assignment binding changed.");
  return data;
}
function definition(row: Row) {
  if (hash(String(row.data)) !== row.sha256)
    throw new DomainError("STATE_INVALID", "Experiment evidence integrity failed.");
  const data = experimentInputSchema.parse(JSON.parse(String(row.data)));
  if (data.id !== row.id || !["active", "stopped"].includes(String(row.state)))
    throw new DomainError("STATE_INVALID", "Experiment binding is invalid.");
  return data;
}
function active(row: Row, now: string) {
  const data = definition(row);
  if (row.state !== "active" || Date.parse(data.expiresAt) <= Date.parse(now))
    throw new DomainError("POLICY_REVOKED", "Experiment is stopped or expired.");
  return data;
}

export { active as activeExperimentDefinition };

export function experimentAssignmentEvidence(row: Row, experiment: Row) {
  const assignment = assignmentData(row);
  const data = definition(experiment);
  if (
    assignment.experimentId !== data.id ||
    !data.variants.some((v) => v.id === assignment.variantId)
  )
    throw new DomainError("STATE_INVALID", "Experiment evidence attribution failed.");
  return { assignment, definition: data };
}

// This guard runs under the submission engine's owner lock, never in receipt
// confirmation: a stop must not erase an already-sent outcome.
export async function assertExperimentDispatch(
  tx: SqlExecutor,
  owner: string,
  applicationId: string,
  packetId: string,
  now: string,
) {
  if (await generationSubmissionHeld(tx, owner, applicationId))
    throw new DomainError(
      "POLICY_REVOKED",
      "Generated enrollment requires exact-packet review and assignment.",
    );
  const row = (
    await tx.query("SELECT * FROM experiment_assignments WHERE owner_id=$1 AND application_id=$2", [
      owner,
      applicationId,
    ])
  )[0];
  if (!row) {
    return null;
  }
  const experiment = (
    await tx.query("SELECT * FROM experiments WHERE owner_id=$1 AND id=$2", [
      owner,
      String(row.experiment_id),
    ])
  )[0];
  if (!experiment) throw new DomainError("STATE_INVALID", "Experiment definition is missing.");
  const data = active(experiment, now);
  if (!data.variants.some((v) => v.id === row.variant_id))
    throw new DomainError("STATE_INVALID", "Assigned variant is invalid.");
  const variant = data.variants.find((item) => item.id === row.variant_id);
  if (variant?.generationRecipe) {
    const generated = await tx.query(
      "SELECT * FROM experiment_generations WHERE owner_id=$1 AND application_id=$2 AND state='assigned'",
      [owner, applicationId],
    );
    if (generated.length !== 1)
      throw new DomainError(
        "STATE_INVALID",
        "Assigned generation evidence is missing or ambiguous.",
      );
    const generatedRow = generated[0];
    if (!generatedRow) throw new DomainError("STATE_INVALID", "Assigned generation is missing.");
    const evidence = generationBinding(generatedRow);
    await assertGenerationSources(tx, owner, evidence, now);
    if (
      generated[0]?.packet_id !== packetId ||
      generated[0]?.packet_sha256 !== row.packet_sha256 ||
      evidence.request.experimentId !== data.id ||
      evidence.request.variantId !== row.variant_id ||
      JSON.stringify(evidence.recipe) !== JSON.stringify(variant.generationRecipe)
    )
      throw new DomainError("PROFILE_STALE", "Assigned generation binding changed.");
  }
  const packet = (
    await tx.query(
      "SELECT manifest,sha256 FROM packets WHERE owner_id=$1 AND id=$2 AND application_id=$3",
      [owner, packetId, applicationId],
    )
  )[0];
  if (
    !packet ||
    row.packet_id !== packetId ||
    row.packet_sha256 !== packet.sha256 ||
    hash(String(packet.manifest)) !== packet.sha256
  )
    throw new DomainError("PROFILE_STALE", "Experiment requires its exact reviewed packet.");
  const assignment = assignmentData(row);
  if (
    assignment.id !== row.id ||
    assignment.experimentId !== row.experiment_id ||
    assignment.applicationId !== applicationId ||
    assignment.packetId !== packetId ||
    assignment.variantId !== row.variant_id ||
    assignment.reviewedPacketSha256 !== row.packet_sha256
  )
    throw new DomainError("STATE_INVALID", "Experiment assignment binding changed.");
  const app = (
    await tx.query("SELECT job_id FROM applications WHERE owner_id=$1 AND id=$2", [
      owner,
      applicationId,
    ])
  )[0];
  const identity = await jobIdentity(tx, owner, String(app?.job_id));
  for (const member of identity.members) {
    if (
      (
        await tx.query(
          "SELECT id FROM experiment_assignments WHERE owner_id=$1 AND canonical_job_id=$2 AND id<>$3",
          [owner, member, row.id],
        )
      ).length
    )
      throw new DomainError(
        "DUPLICATE_SUSPECTED",
        "Equivalent job already has an experiment assignment.",
      );
  }
  if (!identity.members.includes(String(row.canonical_job_id)))
    throw new DomainError("STATE_INVALID", "Assigned job identity changed.");
  return { assignmentId: String(row.id), bindingSha256: hash(String(row.binding)) };
}

export class ExperimentRepository extends OwnerScope {
  async packets() {
    const rows = await this.db.query(
      "SELECT p.id,p.application_id,p.manifest,p.sha256 FROM packets p JOIN applications a ON a.owner_id=p.owner_id AND a.id=p.application_id LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE p.owner_id=$1 AND a.state='READY' AND v.packet_id IS NULL ORDER BY p.created_at DESC,p.id LIMIT 1001",
      [this.ownerId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Ready packet catalog exceeds its bound.");
    return rows.map((row) => {
      const manifest = packetManifestSchema.parse(JSON.parse(String(row.manifest)));
      if (
        hash(String(row.manifest)) !== row.sha256 ||
        manifest.id !== row.id ||
        manifest.applicationId !== row.application_id ||
        manifest.validation.status !== "valid"
      )
        throw new DomainError("STATE_INVALID", "Ready packet evidence integrity failed.");
      return {
        id: String(row.id),
        applicationId: String(row.application_id),
        sha256: String(row.sha256),
      };
    });
  }
  async list() {
    const rows = await this.db.query(
      "SELECT * FROM experiments WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT 1001",
      [this.ownerId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Experiment catalog exceeds its bound.");
    return rows.map((row) => ({
      ...definition(row),
      state: row.state,
      revision: Number(row.revision),
      createdAt: row.created_at,
      stoppedAt: row.stopped_at,
    }));
  }
  async create(raw: unknown) {
    const input = experimentInputSchema.parse(raw);
    for (const variant of input.variants)
      if (variant.generationRecipe) assertLetterVariantRecipe(variant.generationRecipe);
    const data = JSON.stringify(input);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const existing = (
        await tx.query("SELECT * FROM experiments WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          input.id,
        ])
      )[0];
      if (existing) {
        definition(existing);
        if (existing.data !== data)
          throw new DomainError("REVISION_STALE", "Experiment ID cannot be redefined.");
        return { id: input.id, state: existing.state, revision: Number(existing.revision) };
      }
      const duration = Date.parse(input.expiresAt) - this.clock().getTime();
      if (duration <= 0 || duration > 365 * 86400000)
        throw new DomainError("STATE_INVALID", "Experiment expiry must be within the next year.");
      await tx.query(
        "INSERT INTO experiments(owner_id,id,data,sha256,state,revision,created_at) VALUES($1,$2,$3,$4,'active',1,$5)",
        [this.ownerId, input.id, data, hash(data), this.now()],
      );
      await this.audit(
        tx,
        input.id,
        "experiment.created",
        1,
        { metric: input.metric, maximumAssignments: input.maximumAssignments },
        "owner",
      );
      return { id: input.id, state: "active", revision: 1 };
    });
  }
  async stop(id: string, raw: unknown) {
    const input = experimentStopSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM experiments WHERE owner_id=$1 AND id=$2", [this.ownerId, id])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Experiment not found.");
      definition(row);
      if (row.state === "stopped" && Number(row.revision) === input.expectedRevision + 1)
        return { id, state: "stopped", revision: Number(row.revision) };
      if (Number(row.revision) !== input.expectedRevision)
        throw new DomainError("REVISION_STALE", "Experiment revision changed.");
      if (row.state === "stopped") return { id, state: "stopped", revision: Number(row.revision) };
      await tx.query(
        "UPDATE experiments SET state='stopped',revision=revision+1,stopped_at=$1 WHERE owner_id=$2 AND id=$3",
        [this.now(), this.ownerId, id],
      );
      await this.audit(tx, id, "experiment.stopped", input.expectedRevision + 1, {}, "owner");
      return { id, state: "stopped", revision: input.expectedRevision + 1 };
    });
  }
  async assignments(id: string) {
    const rows = await this.db.query(
      "SELECT * FROM experiment_assignments WHERE owner_id=$1 AND experiment_id=$2 ORDER BY created_at,id LIMIT 10001",
      [this.ownerId, id],
    );
    if (rows.length > 10000)
      throw new DomainError("STATE_INVALID", "Assignment catalog exceeds its bound.");
    return rows.map((row) => ({
      ...assignmentData(row),
      canonicalJobId: row.canonical_job_id,
      assignedAt: row.created_at,
    }));
  }
  async assign(raw: unknown) {
    const input = experimentAssignmentSchema.parse(raw);
    const binding = JSON.stringify(input);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const prior = (
        await tx.query("SELECT * FROM experiment_assignments WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          input.id,
        ])
      )[0];
      if (prior) {
        assignmentData(prior);
        if (prior.binding !== binding)
          throw new DomainError("REVISION_STALE", "Assignment ID cannot be redefined.");
        return { id: input.id, assignedAt: prior.created_at };
      }
      const row = (
        await tx.query("SELECT * FROM experiments WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          input.experimentId,
        ])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Experiment not found.");
      const data = active(row, this.now());
      if (!data.variants.some((v) => v.id === input.variantId))
        throw new DomainError("STATE_INVALID", "Variant is not owner-approved.");
      const count = (
        await tx.query(
          "SELECT (SELECT COUNT(*) FROM experiment_assignments WHERE owner_id=$1 AND experiment_id=$2) + (SELECT COUNT(*) FROM experiment_generations WHERE owner_id=$1 AND experiment_id=$2 AND state IN ('queued','drafting','prepared') AND application_id<>$3) AS total",
          [this.ownerId, input.experimentId, input.applicationId],
        )
      )[0];
      if (Number(count?.total) >= data.maximumAssignments)
        throw new DomainError("POLICY_REVOKED", "Experiment assignment limit reached.");
      const app = (
        await tx.query("SELECT job_id,state FROM applications WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          input.applicationId,
        ])
      )[0];
      if (!app) throw new DomainError("NOT_FOUND", "Application not found.");
      if (app.state !== "READY")
        throw new DomainError("STATE_INVALID", "Assignment requires a ready unsent application.");
      for (const table of ["intents", "attempts", "outcome_events"] as const) {
        if (
          (
            await tx.query(
              `SELECT id FROM ${table} WHERE owner_id=$1 AND application_id=$2 LIMIT 1`,
              [this.ownerId, input.applicationId],
            )
          ).length
        )
          throw new DomainError(
            "STATE_INVALID",
            "Assignment must precede intent and outcome evidence.",
          );
      }
      const identity = await jobIdentity(tx, this.ownerId, String(app.job_id));
      for (const member of identity.members) {
        if (
          (
            await tx.query(
              "SELECT id FROM experiment_assignments WHERE owner_id=$1 AND canonical_job_id=$2 LIMIT 1",
              [this.ownerId, member],
            )
          ).length
        )
          throw new DomainError(
            "DUPLICATE_SUSPECTED",
            "A job can receive only one experiment variant.",
          );
      }
      const packet = (
        await tx.query(
          "SELECT p.manifest,p.sha256 FROM packets p LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE p.owner_id=$1 AND p.id=$2 AND p.application_id=$3 AND v.packet_id IS NULL",
          [this.ownerId, input.packetId, input.applicationId],
        )
      )[0];
      if (
        !packet ||
        packet.sha256 !== input.reviewedPacketSha256 ||
        hash(String(packet.manifest)) !== packet.sha256
      )
        throw new DomainError("PROFILE_STALE", "Reviewed packet is missing, invalid or changed.");
      const manifest = packetManifestSchema.parse(JSON.parse(String(packet.manifest)));
      if (
        manifest.id !== input.packetId ||
        manifest.applicationId !== input.applicationId ||
        manifest.jobId !== app.job_id ||
        manifest.validation.status !== "valid"
      )
        throw new DomainError(
          "CLAIM_UNSUPPORTED",
          "Experiment requires an already validated packet.",
        );
      const assignedAt = this.now();
      const generationRows = await tx.query(
        "SELECT * FROM experiment_generations WHERE owner_id=$1 AND application_id=$2 AND state<>'failed' ORDER BY created_at DESC,id DESC LIMIT 2",
        [this.ownerId, input.applicationId],
      );
      if (generationRows.length > 1)
        throw new DomainError("STATE_INVALID", "Generation enrollment is ambiguous.");
      const generated = generationRows[0];
      if (
        !generated &&
        data.variants.find((variant) => variant.id === input.variantId)?.generationRecipe
      )
        throw new DomainError(
          "POLICY_REVOKED",
          "Automatic recipe variants require generation provenance.",
        );
      if (generated) {
        const evidence = generationBinding(generated);
        await assertGenerationSources(tx, this.ownerId, evidence, this.now());
        if (
          generated.state !== "prepared" ||
          generated.packet_id !== input.packetId ||
          generated.packet_sha256 !== input.reviewedPacketSha256 ||
          evidence.request.experimentId !== input.experimentId ||
          evidence.request.variantId !== input.variantId ||
          manifest.letterGeneration?.method !== "llm" ||
          manifest.letterGeneration.generationId !== String(generated.id) ||
          JSON.stringify(manifest.letterGeneration.recipe) !== JSON.stringify(evidence.recipe)
        )
          throw new DomainError(
            "PROFILE_STALE",
            "Assignment requires its exact generated variant packet.",
          );
      } else if (await generationSubmissionHeld(tx, this.ownerId, input.applicationId)) {
        throw new DomainError(
          "POLICY_REVOKED",
          "Failed generation cannot silently become a manual enrollment.",
        );
      }
      await tx.query(
        "INSERT INTO experiment_assignments(owner_id,id,experiment_id,application_id,canonical_job_id,packet_id,packet_sha256,variant_id,binding,binding_sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          this.ownerId,
          input.id,
          input.experimentId,
          input.applicationId,
          identity.canonical,
          input.packetId,
          packet.sha256,
          input.variantId,
          binding,
          hash(binding),
          assignedAt,
        ],
      );
      await this.audit(
        tx,
        input.applicationId,
        "experiment.assigned",
        1,
        { experimentId: input.experimentId, assignmentId: input.id, variantId: input.variantId },
        "owner",
      );
      if (generated) {
        await tx.query(
          "UPDATE experiment_generations SET state='assigned' WHERE owner_id=$1 AND id=$2",
          [this.ownerId, String(generated.id)],
        );
        await tx.query(
          "UPDATE applications SET state='PREPARED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3",
          [this.now(), this.ownerId, input.applicationId],
        );
        await tx.query(
          "INSERT INTO tasks(id,owner_id,application_id,type,domain,state,dedupe_key,payload,priority,run_after,max_attempts,created_at) VALUES($1,$2,$3,'inspect','browser','ready',$4,$5,30,$6,4,$6)",
          [
            randomUUID(),
            this.ownerId,
            input.applicationId,
            `inspect:experiment:${input.id}`,
            JSON.stringify({ schemaVersion: 1, packetId: input.packetId }),
            this.now(),
          ],
        );
      }
      return { id: input.id, assignedAt };
    });
  }
}
