import { createHash } from "node:crypto";
import { z } from "zod";
import { policyInputSchema } from "../../contracts/src/candidate.js";
import { packetRequestedAnswerSchema } from "../../contracts/src/documents.js";
import { experimentGenerationInputSchema } from "../../contracts/src/experiment-generation.js";
import { DomainError } from "../../contracts/src/index.js";
import { letterVariantRecipeSchema } from "../../contracts/src/letter-variant.js";
import { assertLetterVariantRecipe } from "../../documents/src/letter-variants.js";
import type { Row, SqlExecutor } from "./database.js";
import { jobIdentity } from "./job-identity.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const generationHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const generationBindingSchema = z
  .object({
    request: experimentGenerationInputSchema,
    recipe: letterVariantRecipeSchema,
    experimentSha256: sha,
    canonicalJobId: z.string(),
    candidateRevision: z.number().int(),
    profileId: z.string(),
    authorizationId: z.string(),
    authorizationRevision: z.number().int(),
    authorizationSha256: sha,
    assessmentSha256: sha,
    jobSha256: sha,
    answersSha256: sha,
    inputSha256: sha,
    requestedAnswers: z.array(packetRequestedAnswerSchema).max(100),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type GenerationBinding = z.infer<typeof generationBindingSchema>;

export function generationBinding(row: Row) {
  const data = JSON.parse(String(row.data));
  if (generationHash(data) !== row.sha256)
    throw new DomainError("STATE_INVALID", "Generation evidence integrity failed.");
  const parsed = generationBindingSchema.parse(data);
  assertLetterVariantRecipe(parsed.recipe);
  if (
    parsed.request.id !== row.id ||
    parsed.request.applicationId !== row.application_id ||
    parsed.request.experimentId !== row.experiment_id ||
    parsed.canonicalJobId !== row.canonical_job_id
  )
    throw new DomainError("STATE_INVALID", "Generation identity changed.");
  return parsed;
}

export async function generationSubmissionHeld(
  tx: SqlExecutor,
  owner: string,
  applicationId: string,
) {
  const app = (
    await tx.query("SELECT job_id FROM applications WHERE owner_id=$1 AND id=$2", [
      owner,
      applicationId,
    ])
  )[0];
  if (!app) throw new DomainError("NOT_FOUND", "Application not found.");
  const identity = await jobIdentity(tx, owner, String(app.job_id));
  let enrolled = false;
  // Resolve current membership: a later merge must not strand the hold on a
  // duplicate application while its surviving baseline is free to submit.
  for (const member of identity.members) {
    const rows = await tx.query(
      "SELECT g.application_id FROM experiment_generations g JOIN applications a ON a.owner_id=g.owner_id AND a.id=g.application_id WHERE g.owner_id=$1 AND a.job_id=$2",
      [owner, member],
    );
    if (rows.some((row) => row.application_id !== applicationId)) return true;
    enrolled ||= rows.length > 0;
  }
  if (!enrolled) return false;
  const assigned = await tx.query(
    "SELECT g.*,a.variant_id AS assigned_variant_id FROM experiment_generations g JOIN experiment_assignments a ON a.owner_id=g.owner_id AND a.application_id=g.application_id AND a.experiment_id=g.experiment_id AND a.packet_id=g.packet_id AND a.packet_sha256=g.packet_sha256 WHERE g.owner_id=$1 AND g.application_id=$2 AND g.state='assigned' LIMIT 2",
    [owner, applicationId],
  );
  const row = assigned[0];
  return (
    assigned.length !== 1 ||
    !row ||
    generationBinding(row).request.variantId !== row.assigned_variant_id
  );
}

export async function assertGenerationSources(
  tx: SqlExecutor,
  owner: string,
  data: GenerationBinding,
  now: string,
) {
  const candidate = (await tx.query("SELECT * FROM candidates WHERE owner_id=$1", [owner]))[0];
  const authorization = (
    await tx.query("SELECT * FROM authorizations WHERE owner_id=$1 AND id=$2", [
      owner,
      data.authorizationId,
    ])
  )[0];
  const assessment = (
    await tx.query(
      "SELECT data FROM match_assessments WHERE owner_id=$1 AND id=$2 AND application_id=$3",
      [owner, data.request.assessmentId, data.request.applicationId],
    )
  )[0];
  const job = (
    await tx.query(
      "SELECT j.data FROM jobs j JOIN applications a ON a.owner_id=j.owner_id AND a.job_id=j.id WHERE a.owner_id=$1 AND a.id=$2",
      [owner, data.request.applicationId],
    )
  )[0];
  const answers = await tx.query(
    "SELECT id,revision,data FROM approved_answers WHERE owner_id=$1 ORDER BY id LIMIT 2001",
    [owner],
  );
  if (answers.length > 2000)
    throw new DomainError("STATE_INVALID", "Answer inventory exceeds its bound.");
  const policy = authorization
    ? policyInputSchema.strip().parse(JSON.parse(String(authorization.data)))
    : null;
  if (
    !candidate ||
    candidate.active_profile_id !== data.profileId ||
    candidate.active_authorization_id !== data.authorizationId ||
    Number(candidate.revision) !== data.candidateRevision ||
    !authorization ||
    authorization.revoked_at ||
    Number(authorization.revision) !== data.authorizationRevision ||
    generationHash(String(authorization.data)) !== data.authorizationSha256 ||
    !policy ||
    Date.parse(policy.effectiveAt) > Date.parse(now) ||
    Date.parse(policy.expiresAt) <= Date.parse(now) ||
    !assessment ||
    generationHash(String(assessment.data)) !== data.assessmentSha256 ||
    !job ||
    generationHash(String(job.data)) !== data.jobSha256 ||
    generationHash(answers) !== data.answersSha256
  )
    throw new DomainError("PROFILE_STALE", "Generation facts, policy or approved answers changed.");
}
