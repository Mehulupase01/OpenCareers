import { DomainError } from "../../contracts/src/index.js";
import type { SqlExecutor } from "./database.js";

export async function jobIdentity(tx: SqlExecutor, owner: string, jobId: string) {
  const rows = await tx.query(
    "SELECT from_job_id,to_job_id FROM identity_resolutions WHERE owner_id=$1 AND reversed_at IS NULL",
    [owner],
  );
  const parents = new Map(rows.map((r) => [String(r.from_job_id), String(r.to_job_id)]));
  const root = (id: string) => {
    const seen = new Set<string>();
    while (parents.has(id)) {
      if (seen.has(id) || seen.size >= 64)
        throw new DomainError("STATE_INVALID", "Job identity cycle or depth limit.");
      seen.add(id);
      id = parents.get(id) as string;
    }
    return id;
  };
  const canonical = root(jobId);
  return {
    canonical,
    members: [
      ...new Set([canonical, ...[...parents.keys()].filter((id) => root(id) === canonical)]),
    ],
  };
}

export async function assertDiscoveryEligibility(
  tx: SqlExecutor,
  owner: string,
  jobId: string,
  applicationId: string,
  now: string,
) {
  const identity = await jobIdentity(tx, owner, jobId);
  const listings = await tx.query(
    "SELECT l.state,l.last_seen_at,s.state AS source_state FROM discovery_listings l JOIN sources s ON s.owner_id=l.owner_id AND s.id=l.source_id WHERE l.owner_id=$1 AND l.job_id=$2",
    [owner, identity.canonical],
  );
  if (
    listings.length &&
    !listings.some(
      (l) =>
        l.state === "open" &&
        l.source_state === "healthy" &&
        Date.parse(now) - Date.parse(String(l.last_seen_at)) <= 86400000,
    )
  )
    throw new DomainError(
      "JOB_CLOSED",
      "No fresh, healthy open source observation for this vacancy.",
    );
  for (const member of identity.members) {
    const others = await tx.query(
      "SELECT state FROM applications WHERE owner_id=$1 AND job_id=$2 AND id <> $3",
      [owner, member, applicationId],
    );
    if (
      others.some((a) =>
        [
          "CONFIRMED",
          "HISTORICAL_SUBMITTED",
          "IN_FLIGHT",
          "INTENT_RECORDED",
          "UNKNOWN",
          "RECONCILING",
          "NEEDS_REVIEW",
        ].includes(String(a.state)),
      )
    )
      throw new DomainError(
        "DUPLICATE_CONFIRMED",
        "Equivalent requisition has submitted or uncertain work.",
      );
  }
}
