import { createHash, randomUUID } from "node:crypto";
import {
  type AllocationClass,
  allocationClassSchema,
  allocationLimits,
} from "../../contracts/src/agents.js";
import type {
  Authorization,
  CandidateFact,
  ProfileSnapshot,
} from "../../contracts/src/candidate.js";
import { policyInputSchema } from "../../contracts/src/candidate.js";
import { DomainError, jobInputSchema } from "../../contracts/src/index.js";
import {
  assessmentSchema,
  type MatchAssessment,
  type MatchingInput,
  type MatchingSnapshot,
  modelCatalogueSchema,
  type RouteDecision,
  routeDecisionSchema,
} from "../../contracts/src/matching.js";
import { localDayStart, localDayWindow } from "../../domain/src/state.js";
import type { Row } from "./database.js";
import { Repository } from "./repository.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const json = <T>(row: Row, key = "data") => JSON.parse(String(row[key])) as T;

export interface Reservation {
  id: string;
  day: string;
  modelId: string;
  provider: string;
  state: "reserved" | "sent" | "completed" | "failed" | "released";
}

export class MatchingRepository extends Repository {
  async setRoute(rawCatalogue: unknown, rawDecision: RouteDecision) {
    const catalogue = modelCatalogueSchema.parse(rawCatalogue);
    const decision = routeDecisionSchema.parse(rawDecision);
    const content = JSON.stringify(catalogue);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const catalogueId = randomUUID();
      await tx.query(
        "INSERT INTO model_catalogues(owner_id,id,data,sha256,fetched_at) VALUES($1,$2,$3,$4,$5)",
        [this.ownerId, catalogueId, content, hash(content), decision.catalogueFetchedAt],
      );
      const state = {
        modelId: decision.eligible ? decision.modelId : null,
        provider: decision.eligible ? decision.provider : null,
        reason: decision.eligible ? "Eligible free route is ready." : decision.reasons.join(" "),
        privacyBinding: decision.privacyBinding ?? null,
        endpointEvidence: decision.endpointEvidence ?? null,
        allocationClass: decision.allocationClass ?? "semantic_triage",
      };
      await tx.query(
        "INSERT INTO inference_state(owner_id,status,data,catalogue_id,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id) DO UPDATE SET status=excluded.status,data=excluded.data,catalogue_id=excluded.catalogue_id,backoff_until=NULL,updated_at=excluded.updated_at",
        [
          this.ownerId,
          decision.eligible ? "ready" : "paused",
          JSON.stringify(state),
          catalogueId,
          this.now(),
        ],
      );
      await tx.query(
        "DELETE FROM model_catalogues WHERE owner_id=$1 AND id NOT IN (SELECT id FROM model_catalogues WHERE owner_id=$1 ORDER BY fetched_at DESC,id DESC LIMIT 20)",
        [this.ownerId],
      );
      await this.audit(tx, catalogueId, "inference.catalogue_checked", 1, {
        eligible: decision.eligible ? 1 : 0,
      });
      if (decision.eligible && decision.privacyBinding)
        await this.audit(tx, catalogueId, "inference.privacy_bound", 1, {
          binding: decision.privacyBinding,
        });
    });
  }

  async setFixtureRoute(modelId: string, provider: string) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await tx.query(
        "INSERT INTO inference_state(owner_id,status,data,updated_at) VALUES($1,'fixture',$2,$3) ON CONFLICT(owner_id) DO UPDATE SET status='fixture',data=excluded.data,backoff_until=NULL,updated_at=excluded.updated_at",
        [
          this.ownerId,
          JSON.stringify({ modelId, provider, reason: "Synthetic fixture inference only." }),
          this.now(),
        ],
      );
    });
  }

  async setUnavailable(
    status: "paused" | "rate_limited" | "unconfigured",
    reason: string,
    backoffUntil: string | null = null,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await tx.query(
        "INSERT INTO inference_state(owner_id,status,data,backoff_until,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id) DO UPDATE SET status=excluded.status,data=excluded.data,backoff_until=excluded.backoff_until,updated_at=excluded.updated_at",
        [
          this.ownerId,
          status,
          JSON.stringify({ modelId: null, provider: null, reason }),
          backoffUntil,
          this.now(),
        ],
      );
    });
  }

  async reserve(
    modelId: string,
    provider: string,
    dailyLimit: number,
    applicationId: string | null = null,
    expectedPrivacyBinding?: string,
    allocationClass: AllocationClass = "semantic_triage",
  ): Promise<Reservation> {
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 50)
      throw new DomainError("CONFIG_INVALID", "Invalid inference daily limit.");
    allocationClassSchema.parse(allocationClass);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const instant = this.clock();
      const now = instant.toISOString();
      const { day, start, end } = localDayWindow(instant);
      await tx.query(
        "UPDATE inference_reservations SET state='released',completed_at=$1 WHERE owner_id=$2 AND created_at >= $3 AND created_at < $4 AND state='reserved' AND expires_at <= $1",
        [now, this.ownerId, start, end],
      );
      const count = Number(
        (
          await tx.query(
            "SELECT COUNT(*) AS count FROM inference_reservations WHERE owner_id=$1 AND created_at >= $2 AND created_at < $3 AND state <> 'released'",
            [this.ownerId, start, end],
          )
        )[0]?.count,
      );
      if (count >= dailyLimit)
        throw new DomainError("MODEL_QUOTA_EXHAUSTED", "Daily free inference budget is exhausted.");
      const reserve = Math.floor((dailyLimit * allocationLimits.unallocated_reserve) / 50);
      if (allocationClass !== "unallocated_reserve" && count >= dailyLimit - reserve)
        throw new DomainError(
          "MODEL_QUOTA_EXHAUSTED",
          "Protected inference reserve cannot fund routine work.",
        );
      const usedInClass = Number(
        (
          await tx.query(
            "SELECT COUNT(*) AS count FROM inference_reservations WHERE owner_id=$1 AND created_at >= $2 AND created_at < $3 AND allocation_class=$4 AND state <> 'released'",
            [this.ownerId, start, end, allocationClass],
          )
        )[0]?.count,
      );
      const classLimit =
        allocationClass === "unallocated_reserve" ? reserve : allocationLimits[allocationClass];
      if (usedInClass >= classLimit)
        throw new DomainError(
          "MODEL_QUOTA_EXHAUSTED",
          "Inference task-class allocation is exhausted.",
        );
      const state = (
        await tx.query("SELECT * FROM inference_state WHERE owner_id=$1", [this.ownerId])
      )[0];
      if (!state || !["ready", "fixture"].includes(String(state.status)))
        throw new DomainError(
          "MODEL_ROUTE_INELIGIBLE",
          "No eligible free inference route is ready.",
        );
      if (state.backoff_until && String(state.backoff_until) > now)
        throw new DomainError("RATE_LIMITED", "Free inference route is in bounded backoff.", true);
      if (expectedPrivacyBinding) {
        const route = json<{ modelId: string; provider: string; privacyBinding?: string }>(state);
        if (
          route.modelId !== modelId ||
          route.provider !== provider ||
          route.privacyBinding !== expectedPrivacyBinding
        )
          throw new DomainError(
            "MODEL_ROUTE_INELIGIBLE",
            "Reviewed route changed before quota reservation.",
          );
      }
      const id = randomUUID();
      await tx.query(
        "INSERT INTO inference_reservations(owner_id,id,day,state,application_id,model_id,provider,created_at,expires_at,allocation_class) VALUES($1,$2,$3,'reserved',$4,$5,$6,$7,$8,$9)",
        [
          this.ownerId,
          id,
          day,
          applicationId,
          modelId,
          provider,
          now,
          new Date(instant.getTime() + 60000).toISOString(),
          allocationClass,
        ],
      );
      return { id, day, modelId, provider, state: "reserved" };
    });
  }

  async markSent(id: string, requestHash: string, expectedPrivacyBinding?: string) {
    if (!/^[a-f0-9]{64}$/.test(requestHash))
      throw new DomainError("CONFIG_INVALID", "Invalid redacted request hash.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      if (expectedPrivacyBinding) {
        const reservation = (
          await tx.query("SELECT * FROM inference_reservations WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            id,
          ])
        )[0];
        const state = (
          await tx.query("SELECT * FROM inference_state WHERE owner_id=$1", [this.ownerId])
        )[0];
        const route = state
          ? json<{ modelId: string; provider: string; privacyBinding?: string }>(state)
          : null;
        if (
          !reservation ||
          String(reservation.expires_at) <= this.now() ||
          state?.status !== "ready" ||
          route?.privacyBinding !== expectedPrivacyBinding ||
          route.modelId !== reservation.model_id ||
          route.provider !== reservation.provider
        )
          throw new DomainError(
            "MODEL_ROUTE_INELIGIBLE",
            "Reviewed disclosure authorization changed or expired before sending.",
          );
      }
      const rows = await tx.query(
        "UPDATE inference_reservations SET state='sent',request_hash=$1 WHERE owner_id=$2 AND id=$3 AND state='reserved' AND expires_at > $4 RETURNING id",
        [requestHash, this.ownerId, id, this.now()],
      );
      if (!rows.length) throw new DomainError("REVISION_STALE", "Inference reservation is stale.");
      if (expectedPrivacyBinding)
        await this.audit(tx, id, "inference.disclosure_authorized", 1, {
          binding: expectedPrivacyBinding,
          requestHash,
        });
    });
  }

  async finish(
    id: string,
    result:
      | { status: "completed"; responseHash: string }
      | { status: "failed"; errorCode: string; backoffUntil?: string },
    metrics?: { latencyMs: number; tokens: number | null },
  ) {
    if (
      metrics &&
      (!Number.isSafeInteger(metrics.latencyMs) ||
        metrics.latencyMs < 0 ||
        metrics.latencyMs > 600000 ||
        (metrics.tokens !== null &&
          (!Number.isSafeInteger(metrics.tokens) ||
            metrics.tokens < 0 ||
            metrics.tokens > 1000000)))
    )
      throw new DomainError("CONFIG_INVALID", "Invalid bounded inference observation.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const rows = await tx.query(
        "UPDATE inference_reservations SET state=$1,response_hash=$2,error_code=$3,completed_at=$4 WHERE owner_id=$5 AND id=$6 AND state='sent' RETURNING *",
        [
          result.status,
          result.status === "completed" ? result.responseHash : null,
          result.status === "failed" ? result.errorCode : null,
          this.now(),
          this.ownerId,
          id,
        ],
      );
      if (!rows.length) throw new DomainError("REVISION_STALE", "Inference outcome is stale.");
      if (metrics) {
        await tx.query(
          "INSERT INTO inference_observations(owner_id,reservation_id,latency_ms,tokens,observed_at) VALUES($1,$2,$3,$4,$5)",
          [this.ownerId, id, metrics.latencyMs, metrics.tokens, this.now()],
        );
        await tx.query(
          "DELETE FROM inference_observations WHERE owner_id=$1 AND reservation_id NOT IN (SELECT reservation_id FROM inference_observations WHERE owner_id=$1 ORDER BY observed_at DESC,reservation_id DESC LIMIT 2000)",
          [this.ownerId],
        );
      }
      if (result.status === "failed" && result.backoffUntil)
        await tx.query(
          "UPDATE inference_state SET status='rate_limited',backoff_until=$1,data=$2,updated_at=$3 WHERE owner_id=$4",
          [
            result.backoffUntil,
            JSON.stringify({ modelId: null, provider: null, reason: "Bounded upstream backoff." }),
            this.now(),
            this.ownerId,
          ],
        );
      await this.audit(tx, id, `inference.${result.status}`, 1, {
        errorCode: result.status === "failed" ? result.errorCode : null,
      });
    });
  }

  async release(id: string) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await tx.query(
        "UPDATE inference_reservations SET state='released',completed_at=$1 WHERE owner_id=$2 AND id=$3 AND state='reserved'",
        [this.now(), this.ownerId, id],
      );
    });
  }

  async routeSamples(allocationClass: AllocationClass) {
    allocationClassSchema.parse(allocationClass);
    const cutoff = new Date(this.clock().getTime() - 30 * 86400000).toISOString();
    const rows = await this.db.query(
      "SELECT r.model_id,r.provider,r.state,r.error_code,o.latency_ms,o.observed_at FROM inference_observations o JOIN inference_reservations r ON r.owner_id=o.owner_id AND r.id=o.reservation_id WHERE o.owner_id=$1 AND r.allocation_class=$2 AND o.observed_at >= $3 ORDER BY o.observed_at DESC,o.reservation_id DESC LIMIT 2000",
      [this.ownerId, allocationClass, cutoff],
    );
    return rows
      .filter((row) => row.error_code !== "MODEL_QUOTA_EXHAUSTED")
      .map((row) => ({
        modelId: String(row.model_id),
        provider: String(row.provider),
        accepted: row.state === "completed",
        latencyMs: Number(row.latency_ms),
        observedAt: String(row.observed_at),
      }));
  }

  async pendingJobIds(limit = 5): Promise<string[]> {
    const candidate = (
      await this.db.query(
        "SELECT c.active_profile_id,a.data AS authorization_data FROM candidates c LEFT JOIN authorizations a ON a.owner_id=c.owner_id AND a.id=c.active_authorization_id WHERE c.owner_id=$1",
        [this.ownerId],
      )
    )[0];
    if (!candidate?.active_profile_id || !candidate.authorization_data) return [];
    const policy = policyInputSchema
      .strip()
      .parse(JSON.parse(String(candidate.authorization_data)));
    if (policy.profileVersionId !== String(candidate.active_profile_id)) return [];
    const rows = await this.db.query(
      "SELECT DISTINCT l.job_id FROM discovery_listings l JOIN candidates c ON c.owner_id=l.owner_id AND c.active_profile_id IS NOT NULL LEFT JOIN inference_state s ON s.owner_id=l.owner_id WHERE l.owner_id=$1 AND l.state='open' AND NOT EXISTS (SELECT 1 FROM match_assessments m WHERE m.owner_id=l.owner_id AND m.job_id=l.job_id AND m.profile_id=c.active_profile_id AND (m.data NOT LIKE '%\"outcome\":\"inference_paused\"%' OR (m.created_at >= COALESCE(s.updated_at,'') AND m.created_at >= $3))) ORDER BY l.job_id LIMIT $2",
      [this.ownerId, limit, localDayStart(this.clock()).toISOString()],
    );
    return rows.map((row) => String(row.job_id));
  }

  async input(jobId: string): Promise<MatchingInput> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = (
        await tx.query("SELECT * FROM candidates WHERE owner_id=$1", [this.ownerId])
      )[0];
      if (!candidate?.active_profile_id || !candidate.active_authorization_id)
        throw new DomainError(
          "ANSWER_UNKNOWN",
          "Matching needs an active profile and owner policy.",
        );
      const profileRow = (
        await tx.query("SELECT * FROM profile_versions WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          candidate.active_profile_id,
        ])
      )[0];
      const policyRow = (
        await tx.query("SELECT * FROM authorizations WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          candidate.active_authorization_id,
        ])
      )[0];
      const listing = (
        await tx.query(
          "SELECT l.*,j.data AS job_data FROM discovery_listings l JOIN jobs j ON j.owner_id=l.owner_id AND j.id=l.job_id WHERE l.owner_id=$1 AND l.job_id=$2 ORDER BY CASE l.state WHEN 'open' THEN 0 WHEN 'missing' THEN 1 ELSE 2 END,l.last_seen_at DESC LIMIT 1",
          [this.ownerId, jobId],
        )
      )[0];
      if (!profileRow || !policyRow || !listing)
        throw new DomainError("NOT_FOUND", "Matching inputs are incomplete.");
      const profile = json<ProfileSnapshot>(profileRow);
      const policy = policyInputSchema.strip().parse(json<Authorization>(policyRow));
      if (policy.profileVersionId !== profile.id)
        throw new DomainError(
          "PROFILE_STALE",
          "Matching policy does not authorize the active profile revision.",
        );
      const duplicate = (
        await tx.query(
          "SELECT id FROM applications WHERE owner_id=$1 AND job_id=$2 AND state IN ('CONFIRMED','HISTORICAL_SUBMITTED','DUPLICATE') LIMIT 1",
          [this.ownerId, jobId],
        )
      ).length;
      return {
        job: jobInputSchema.strip().parse(json(listing, "job_data")),
        facts: profile.facts as CandidateFact[],
        profileId: String(profileRow.id),
        roleTerms: policy.roleTerms,
        countries: policy.countries,
        salaryMinimum: policy.salary?.minimum ?? null,
        salaryNegotiable: policy.salaryNegotiable,
        listingState: String(listing.state) as MatchingInput["listingState"],
        duplicate: Boolean(duplicate),
      };
    });
  }

  async saveAssessment(raw: MatchAssessment): Promise<MatchAssessment> {
    const assessment = assessmentSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const revision =
        Number(
          (
            await tx.query(
              "SELECT COALESCE(MAX(revision),0) AS revision FROM match_assessments WHERE owner_id=$1 AND job_id=$2 AND profile_id=$3",
              [this.ownerId, assessment.jobId, assessment.profileId],
            )
          )[0]?.revision,
        ) + 1;
      const saved = { ...assessment, revision, createdAt: this.now() };
      const content = JSON.stringify(saved);
      await tx.query(
        "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,application_id,revision,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          this.ownerId,
          saved.id,
          saved.jobId,
          saved.profileId,
          saved.applicationId,
          revision,
          content,
          hash(content),
          saved.createdAt,
        ],
      );
      await this.audit(tx, saved.id, "match.assessed", revision, {
        outcome: saved.outcome,
        score: saved.score.total,
      });
      if (saved.outcome === "auto_eligible" && saved.applicationId)
        await this.enqueueIn(tx, {
          type: "prepare",
          domain: "documents",
          applicationId: saved.applicationId,
          dedupeKey: `prepare:${saved.id}`,
          payload: { schemaVersion: 1, assessmentId: saved.id },
          priority: 20,
        });
      return assessmentSchema.parse(saved);
    });
  }

  async snapshot(dailyLimit: number): Promise<MatchingSnapshot> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const state = (
        await tx.query("SELECT * FROM inference_state WHERE owner_id=$1", [this.ownerId])
      )[0];
      const data = state
        ? json<{
            modelId: string | null;
            provider: string | null;
            reason: string;
            privacyBinding?: string;
            allocationClass?: AllocationClass;
          }>(state)
        : { modelId: null, provider: null, reason: "Inference is not configured." };
      const { day, start, end } = localDayWindow(this.clock());
      const reservations = await tx.query(
        "SELECT state FROM inference_reservations WHERE owner_id=$1 AND created_at >= $2 AND created_at < $3",
        [this.ownerId, start, end],
      );
      const used = reservations.filter((row) =>
        ["sent", "completed", "failed"].includes(String(row.state)),
      ).length;
      const reserved = reservations.filter((row) => row.state === "reserved").length;
      const latest = await tx.query(
        "SELECT a.data FROM match_assessments a WHERE a.owner_id=$1 AND a.revision=(SELECT MAX(b.revision) FROM match_assessments b WHERE b.owner_id=a.owner_id AND b.job_id=a.job_id AND b.profile_id=a.profile_id) ORDER BY a.created_at DESC,a.id DESC LIMIT 200",
        [this.ownerId],
      );
      return {
        route: {
          status: (state?.status ?? "unconfigured") as MatchingSnapshot["route"]["status"],
          modelId: data.modelId,
          provider: data.provider,
          lastCatalogueAt: state?.catalogue_id
            ? String(
                (
                  await tx.query(
                    "SELECT fetched_at FROM model_catalogues WHERE owner_id=$1 AND id=$2",
                    [this.ownerId, state.catalogue_id],
                  )
                )[0]?.fetched_at ?? "",
              ) || null
            : null,
          backoffUntil: (state?.backoff_until as string | null) ?? null,
          reason: data.reason,
          privacyBinding: "privacyBinding" in data ? (data.privacyBinding ?? null) : null,
          allocationClass: "allocationClass" in data ? (data.allocationClass ?? null) : null,
        },
        budget: { day, limit: dailyLimit, used, reserved },
        assessments: latest.map((row) => assessmentSchema.parse(json(row))),
      };
    });
  }
}
