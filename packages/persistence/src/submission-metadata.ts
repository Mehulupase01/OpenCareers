import { createHash } from "node:crypto";
import { submissionCohortMetadataSchema } from "../../contracts/src/cohort.js";
import { normalizedJobSchema } from "../../contracts/src/discovery.js";
import { DomainError, jobInputSchema } from "../../contracts/src/index.js";
import { classifyVacancySignals } from "../../matching/src/vacancy-signals.js";
import type { SqlExecutor } from "./database.js";

export async function captureSubmissionMetadata(tx: SqlExecutor, ownerId: string, jobId: string) {
  const row = (
    await tx.query("SELECT data FROM jobs WHERE owner_id=$1 AND id=$2", [ownerId, jobId])
  )[0];
  if (!row) throw new DomainError("NOT_FOUND", "Submission job metadata is missing.");
  const job = jobInputSchema.parse(JSON.parse(String(row.data)));
  if (job.id !== jobId)
    throw new DomainError("STATE_INVALID", "Submission job metadata attribution failed.");
  const listings = await tx.query(
    "SELECT data,original_job_id FROM discovery_listings WHERE owner_id=$1 AND job_id=$2 LIMIT 101",
    [ownerId, jobId],
  );
  if (listings.length > 100)
    throw new DomainError("STATE_INVALID", "Submission listing metadata exceeds its bound.");
  const families = new Set<string>();
  for (const row of listings) {
    const listing = normalizedJobSchema.parse(JSON.parse(String(row.data)));
    if (listing.id !== row.original_job_id)
      throw new DomainError("STATE_INVALID", "Submission listing metadata attribution failed.");
    if (listing.roleFamily?.trim()) families.add(listing.roleFamily.trim());
  }
  return submissionCohortMetadataSchema.parse({
    method: "frozen_job_at_intent_v2",
    jobId,
    jobSha256: createHash("sha256").update(String(row.data)).digest("hex"),
    source: job.source,
    roleFamily: families.size === 1 ? [...families][0] : "unknown",
    synthetic: job.synthetic,
    vacancySignals: classifyVacancySignals(job),
  });
}
