import { createHash } from "node:crypto";
import {
  cohortComparisonInputSchema,
  cohortSnapshotInputSchema,
  type FixedCohort,
  fixedCohortSchema,
} from "../../contracts/src/cohort.js";
import { normalizedJobSchema } from "../../contracts/src/discovery.js";
import { packetManifestSchema } from "../../contracts/src/documents.js";
import { DomainError, jobInputSchema } from "../../contracts/src/index.js";
import { outcomeKindSchema } from "../../contracts/src/outcome.js";
import { receiptEvidenceSchema } from "../../contracts/src/submission.js";
import { compareFixedCohorts, fixedCohortReport } from "../../matching/src/cohort-report.js";
import type { Row, SqlExecutor } from "./database.js";
import { experimentAssignmentEvidence } from "./experiment-repository.js";
import { OwnerScope } from "./owner-scope.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const parseOptional = (raw: unknown): unknown => {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
};
function decode(row: Row | undefined, id: string) {
  if (!row) throw new DomainError("NOT_FOUND", "Fixed cohort not found.");
  if (hash(String(row.data)) !== row.sha256)
    throw new DomainError("STATE_INVALID", "Fixed cohort integrity check failed.");
  const snapshot = fixedCohortSchema.parse(JSON.parse(String(row.data)));
  if (snapshot.id !== id)
    throw new DomainError("STATE_INVALID", "Fixed cohort attribution check failed.");
  return snapshot;
}
export class CohortRepository extends OwnerScope {
  private async read(tx: SqlExecutor, id: string) {
    return decode(
      (
        await tx.query("SELECT data,sha256 FROM outcome_cohorts WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          id,
        ])
      )[0],
      id,
    );
  }
  async report(id: string) {
    return fixedCohortReport(await this.read(this.db, id));
  }
  async list() {
    const rows = await this.db.query(
      "SELECT id,data,sha256 FROM outcome_cohorts WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1001",
      [this.ownerId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Cohort catalog exceeds its bounded size.");
    return rows.map((row) => {
      const report = fixedCohortReport(decode(row, String(row.id)));
      return {
        id: report.snapshotId,
        window: report.window,
        denominator: report.denominator,
        status: report.status,
      };
    });
  }
  async compare(raw: unknown) {
    const input = cohortComparisonInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const left = await this.read(tx, input.leftSnapshotId);
      const right =
        input.leftSnapshotId === input.rightSnapshotId
          ? left
          : await this.read(tx, input.rightSnapshotId);
      return compareFixedCohorts(left, right, input.dimension, input.leftValue, input.rightValue);
    });
  }
  async record(raw: unknown) {
    const input = cohortSnapshotInputSchema.parse(raw),
      binding = hash(JSON.stringify(input));
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const prior = (
        await tx.query(
          "SELECT binding,data,sha256 FROM outcome_cohorts WHERE owner_id=$1 AND id=$2",
          [this.ownerId, input.id],
        )
      )[0];
      if (prior) {
        if (prior.binding !== binding)
          throw new DomainError("REVISION_STALE", "Fixed cohort identity was already used.");
        return fixedCohortReport(decode(prior, input.id));
      }
      const asOf = this.now(),
        from = Date.parse(input.from),
        through = Date.parse(input.through);
      if (from > through || through > Date.parse(asOf))
        throw new DomainError("STATE_INVALID", "Invalid completed receipt window.");
      const applications = await tx.query(
        "SELECT a.id,a.job_id,a.state,a.created_at,j.data FROM applications a JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE a.owner_id=$1 ORDER BY a.id LIMIT 10001",
        [this.ownerId],
      );
      const receipts = await tx.query(
        "SELECT r.*,i.packet_id,i.snapshot AS intent_snapshot,i.sha256 AS intent_sha256,i.created_at AS intent_created_at,t.dispatch_started_at,p.manifest,p.sha256 AS packet_sha256 FROM receipts r JOIN attempts t ON t.owner_id=r.owner_id AND t.id=r.attempt_id AND t.application_id=r.application_id JOIN intents i ON i.owner_id=t.owner_id AND i.id=t.intent_id AND i.application_id=t.application_id LEFT JOIN packets p ON p.owner_id=i.owner_id AND p.id=i.packet_id AND p.application_id=i.application_id WHERE r.owner_id=$1 AND t.state='CONFIRMED' AND r.observed_at<=$2 ORDER BY r.observed_at,r.id LIMIT 100001",
        [this.ownerId, asOf],
      );
      const events = await tx.query(
        "SELECT id,application_id,revision,kind,evidence_sha256,occurred_at FROM outcome_events WHERE owner_id=$1 AND recorded_at<=$2 AND occurred_at<=$2 ORDER BY revision LIMIT 100001",
        [this.ownerId, asOf],
      );
      const listings = await tx.query(
        "SELECT job_id,data FROM discovery_listings WHERE owner_id=$1 LIMIT 10001",
        [this.ownerId],
      );
      const identities = await tx.query(
        "SELECT from_job_id,to_job_id FROM identity_resolutions WHERE owner_id=$1 AND reversed_at IS NULL LIMIT 10001",
        [this.ownerId],
      );
      const assignments = await tx.query(
        "SELECT a.*,e.id AS definition_id,e.data AS experiment_data,e.sha256 AS experiment_sha256,e.state AS experiment_state FROM experiment_assignments a JOIN experiments e ON e.owner_id=a.owner_id AND e.id=a.experiment_id WHERE a.owner_id=$1 AND a.created_at<=$2 LIMIT 10001",
        [this.ownerId, asOf],
      );
      if (
        applications.length > 10000 ||
        receipts.length > 100000 ||
        events.length > 100000 ||
        listings.length > 10000 ||
        identities.length > 10000 ||
        assignments.length > 10000
      )
        throw new DomainError("STATE_INVALID", "Cohort capture exceeds its bounded read size.");
      const parents = new Map(
        identities.map((row) => [String(row.from_job_id), String(row.to_job_id)]),
      );
      const canonical = (rawId: string) => {
        let id = rawId;
        const seen = new Set<string>();
        while (parents.has(id)) {
          if (seen.has(id) || seen.size >= 64)
            throw new DomainError("STATE_INVALID", "Job identity cycle or depth limit.");
          seen.add(id);
          id = parents.get(id) as string;
        }
        return id;
      };
      const byReceipt = new Map<string, Row>();
      const byAssignment = new Map(assignments.map((row) => [String(row.application_id), row]));
      for (const row of receipts)
        if (!byReceipt.has(String(row.application_id)))
          byReceipt.set(String(row.application_id), row);
      const byEvents = new Map<string, Row[]>();
      for (const row of events) {
        const id = String(row.application_id),
          history = byEvents.get(id) ?? [];
        history.push(row);
        byEvents.set(id, history);
      }
      const roleFamilies = new Map<string, Set<string>>();
      for (const row of listings) {
        const job = normalizedJobSchema.parse(JSON.parse(String(row.data))),
          id = canonical(String(row.job_id));
        if (canonical(job.id) !== id)
          throw new DomainError("STATE_INVALID", "Listing metadata attribution check failed.");
        if (!job.roleFamily) continue;
        const families = roleFamilies.get(id) ?? new Set<string>();
        families.add(job.roleFamily);
        roleFamilies.set(id, families);
      }
      const exclusions = {
        synthetic: 0,
        unverified: 0,
        unresolved: 0,
        outsideWindow: 0,
        stillObserving: 0,
        duplicate: 0,
      };
      const members: FixedCohort["members"] = [],
        jobs = new Set<string>();
      for (const row of applications) {
        const job = jobInputSchema.parse(JSON.parse(String(row.data)));
        if (job.id !== row.job_id)
          throw new DomainError("STATE_INVALID", "Job attribution check failed.");
        if (job.synthetic) {
          exclusions.synthetic++;
          continue;
        }
        if (row.state === "DUPLICATE") {
          exclusions.duplicate++;
          continue;
        }
        const receipt = byReceipt.get(String(row.id));
        if (!receipt) {
          exclusions.unverified++;
          continue;
        }
        if (row.state !== "CONFIRMED") {
          exclusions.unresolved++;
          continue;
        }
        const evidence = receiptEvidenceSchema.safeParse(parseOptional(receipt.evidence));
        if (
          !evidence.success ||
          evidence.data.kind === "mock_ats" ||
          evidence.data.jobId !== row.job_id ||
          hash(String(receipt.evidence)) !== receipt.sha256 ||
          Date.parse(evidence.data.receivedAt) < Date.parse(String(row.created_at)) ||
          Date.parse(evidence.data.receivedAt) > Date.parse(String(receipt.observed_at)) ||
          (evidence.data.kind === "gmail" &&
            (evidence.data.applicationId !== row.id ||
              evidence.data.attemptId !== receipt.attempt_id))
        ) {
          exclusions.unverified++;
          continue;
        }
        const received = Date.parse(String(receipt.observed_at)),
          horizon = received + input.observationDays * 86400000;
        if (received < from || received > through) {
          exclusions.outsideWindow++;
          continue;
        }
        if (horizon > Date.parse(asOf)) {
          exclusions.stillObserving++;
          continue;
        }
        const jobId = canonical(job.id);
        if (jobs.has(jobId)) {
          exclusions.duplicate++;
          continue;
        }
        jobs.add(jobId);
        const event = (byEvents.get(String(row.id)) ?? [])
          .filter((item) => Date.parse(String(item.occurred_at)) <= horizon)
          .at(-1);
        const families = roleFamilies.get(jobId);
        const manifest = packetManifestSchema.safeParse(parseOptional(receipt.manifest));
        const documentTemplate =
          manifest.success &&
          hash(String(receipt.manifest)) === receipt.packet_sha256 &&
          manifest.data.applicationId === row.id &&
          manifest.data.jobId === row.job_id &&
          manifest.data.id === receipt.packet_id
            ? `${manifest.data.templateVersions.cv}/${manifest.data.templateVersions.letter}/${manifest.data.letterGeneration?.method ?? "unknown"}`
            : "unknown";
        const groups = {
          source: job.source,
          roleFamily: families?.size === 1 ? ([...families][0] as string) : "unknown",
          seniority: "unknown" as const,
          sponsorship: "unknown" as const,
          documentTemplate,
          experimentVariant: "unassigned",
        };
        let experiment: FixedCohort["members"][number]["experiment"];
        const assigned = byAssignment.get(String(row.id));
        if (assigned) {
          const evidence = experimentAssignmentEvidence(assigned, {
            id: assigned.definition_id,
            data: assigned.experiment_data,
            sha256: assigned.experiment_sha256,
            state: assigned.experiment_state,
          });
          const intent = parseOptional(receipt.intent_snapshot) as {
            experiment?: { assignmentId?: string; bindingSha256?: string };
            packetId?: string;
            applicationId?: string;
          } | null;
          const assignedAt = Date.parse(String(assigned.created_at));
          const intentAt = Date.parse(String(receipt.intent_created_at));
          const dispatchedAt = Date.parse(String(receipt.dispatch_started_at));
          if (
            !manifest.success ||
            hash(String(receipt.manifest)) !== receipt.packet_sha256 ||
            hash(String(receipt.intent_snapshot)) !== receipt.intent_sha256 ||
            intent?.experiment?.assignmentId !== evidence.assignment.id ||
            intent.experiment.bindingSha256 !== assigned.binding_sha256 ||
            intent.packetId !== receipt.packet_id ||
            intent.applicationId !== row.id ||
            evidence.assignment.packetId !== receipt.packet_id ||
            evidence.assignment.reviewedPacketSha256 !== receipt.packet_sha256 ||
            canonical(String(assigned.canonical_job_id)) !== jobId ||
            !Number.isFinite(assignedAt) ||
            !Number.isFinite(intentAt) ||
            !Number.isFinite(dispatchedAt) ||
            assignedAt > intentAt ||
            intentAt > dispatchedAt ||
            dispatchedAt > received
          )
            throw new DomainError("STATE_INVALID", "Receipt-backed experiment attribution failed.");
          const variant = evidence.definition.variants.find(
            (v) => v.id === evidence.assignment.variantId,
          );
          if (!variant)
            throw new DomainError("STATE_INVALID", "Assigned variant evidence missing.");
          experiment = {
            id: evidence.definition.id,
            variantId: variant.id,
            metric: evidence.definition.metric,
            observationDays: evidence.definition.observationDays,
            definitionSha256: String(assigned.experiment_sha256),
            assignmentSha256: String(assigned.binding_sha256),
            approvalSha256: variant.approvalSha256,
            packetSha256: String(receipt.packet_sha256),
          };
          groups.experimentVariant = `${experiment.id}/${experiment.variantId}`;
        } else if (
          (parseOptional(receipt.intent_snapshot) as { experiment?: unknown } | null)?.experiment !=
          null
        ) {
          throw new DomainError(
            "STATE_INVALID",
            "Dispatched experiment assignment evidence is missing.",
          );
        }
        members.push({
          applicationId: String(row.id),
          jobId,
          receiptId: String(receipt.id),
          receiptSha256: String(receipt.sha256),
          receivedAt: new Date(received).toISOString(),
          horizon: new Date(horizon).toISOString(),
          outcome: event ? outcomeKindSchema.parse(event.kind) : "UNKNOWN",
          outcomeEventId: event ? String(event.id) : null,
          outcomeEvidenceSha256: event ? String(event.evidence_sha256) : null,
          metadataSha256: hash(JSON.stringify(experiment ? { groups, experiment } : groups)),
          groups,
          ...(experiment ? { experiment } : {}),
        });
      }
      const snapshot = fixedCohortSchema.parse({
        id: input.id,
        methodology: "fixed_current_outcome_at_observation_horizon_v1",
        window: {
          from: input.from,
          through: input.through,
          asOf,
          observationDays: input.observationDays,
          minimumSample: input.minimumSample,
        },
        recordedAt: asOf,
        exclusions,
        members,
      });
      const data = JSON.stringify(snapshot);
      await tx.query(
        "INSERT INTO outcome_cohorts(owner_id,id,binding,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [this.ownerId, input.id, binding, data, hash(data), asOf],
      );
      await this.audit(
        tx,
        input.id,
        "outcome.cohort_recorded",
        1,
        { members: members.length },
        "owner",
      );
      return fixedCohortReport(snapshot);
    });
  }
}
