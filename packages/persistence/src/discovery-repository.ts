import { randomUUID } from "node:crypto";
import {
  type DiscoveryBatch,
  type DiscoveryListing,
  type DiscoverySnapshot,
  type DiscoverySource,
  type HistoryRecord,
  historyRecordSchema,
  type NormalizedJob,
  normalizedJobSchema,
  type SourceHealth,
  type SourceInput,
  type SourcePage,
  type SourceRun,
  sourceInputSchema,
} from "../../contracts/src/discovery.js";
import { DomainError, jobInputSchema } from "../../contracts/src/index.js";
import { digest, recognizeUrl, sourceKey } from "../../discovery/src/normalize.js";
import type { Row, SqlExecutor } from "./database.js";
import { jobIdentity } from "./job-identity.js";
import { Repository } from "./repository.js";

const sourceFrom = (r: Row): DiscoverySource => ({
  ...sourceInputSchema.parse(JSON.parse(String(r.policy))),
  id: String(r.id),
  revision: Number(r.revision),
  health: r.state as SourceHealth,
  nextPollAt: String(r.next_poll_at),
  lastSuccessAt: r.last_success_at as string | null,
  lastAttemptAt: r.last_attempt_at as string | null,
  count: Number(r.job_count),
  failures: Number(r.failures),
  etag: r.etag as string | null,
  leaseToken: r.lease_token as string | null,
  leaseUntil: r.lease_until as string | null,
});
const listingFrom = (r: Row): DiscoveryListing => ({
  id: String(r.id),
  sourceId: String(r.source_id),
  jobId: String(r.job_id),
  originalJobId: String(r.original_job_id),
  job: normalizedJobSchema.parse({ ...JSON.parse(String(r.data)), id: String(r.job_id) }),
  state: r.state as DiscoveryListing["state"],
  firstSeenAt: String(r.first_seen_at),
  lastSeenAt: String(r.last_seen_at),
  missingSince: r.missing_since as string | null,
  lastRunId: String(r.last_run_id),
});
const runFrom = (r: Row): SourceRun => ({
  id: String(r.id),
  sourceId: String(r.source_id),
  startedAt: String(r.started_at),
  completedAt: String(r.completed_at),
  health: r.health as SourceHealth,
  count: Number(r.job_count),
  durationMs: Number(r.duration_ms),
  warnings: JSON.parse(String(r.warnings)),
});
const protectedStates = [
  "IN_FLIGHT",
  "UNKNOWN",
  "RECONCILING",
  "NEEDS_REVIEW",
  "CONFIRMED",
  "HISTORICAL_SUBMITTED",
];

export class DiscoveryRepository extends Repository {
  async snapshot(offset = 0, query = ""): Promise<DiscoverySnapshot> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 500000 || query.length > 240)
      throw new DomainError("CONFIG_INVALID", "Invalid listing page.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      return {
        sources: (
          await tx.query("SELECT * FROM sources WHERE owner_id=$1 ORDER BY id", [this.ownerId])
        ).map(sourceFrom),
        listings: (
          await tx.query(
            "SELECT * FROM discovery_listings WHERE owner_id=$1 AND LOWER(data) LIKE $2 ORDER BY first_seen_at DESC,id LIMIT 50 OFFSET $3",
            [
              this.ownerId,
              `%${query.toLowerCase().replaceAll("%", "").replaceAll("_", "")}%`,
              offset,
            ],
          )
        ).map(listingFrom),
        listingCount: Number(
          (
            await tx.query(
              "SELECT COUNT(*) AS count FROM discovery_listings WHERE owner_id=$1 AND LOWER(data) LIKE $2",
              [this.ownerId, `%${query.toLowerCase().replaceAll("%", "").replaceAll("_", "")}%`],
            )
          )[0]?.count,
        ),
        resolutions: (
          await tx.query(
            "SELECT * FROM identity_resolutions WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
            [this.ownerId],
          )
        ).map((r) => ({
          id: String(r.id),
          from: String(r.from_job_id),
          to: String(r.to_job_id),
          reason: String(r.reason),
          reversedAt: r.reversed_at as string | null,
        })),
        runs: (
          await tx.query(
            "SELECT * FROM source_runs WHERE owner_id=$1 ORDER BY completed_at DESC,id DESC LIMIT 100",
            [this.ownerId],
          )
        ).map(runFrom),
        history: (
          await tx.query(
            "SELECT * FROM historical_records WHERE owner_id=$1 ORDER BY imported_at DESC,id LIMIT 2000",
            [this.ownerId],
          )
        ).map((r) => ({
          ...historyRecordSchema.parse(JSON.parse(String(r.data))),
          id: String(r.id),
          jobId: r.job_id as string | null,
          importedAt: String(r.imported_at),
        })),
      };
    });
  }
  async saveSource(raw: SourceInput): Promise<DiscoverySource> {
    const input = sourceInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const existing = (
        await tx.query("SELECT * FROM sources WHERE owner_id=$1 AND source_key=$2", [
          this.ownerId,
          sourceKey(input),
        ])
      )[0];
      if (
        (input.id && input.id !== existing?.id) ||
        Number(existing?.revision ?? 0) !== input.expectedRevision
      )
        throw new DomainError(
          "REVISION_STALE",
          "Source configuration changed; refresh before saving.",
        );
      if (
        existing &&
        (sourceFrom(existing).employerId !== input.employerId ||
          sourceFrom(existing).mode !== input.mode)
      )
        throw new DomainError(
          "CONFIG_INVALID",
          "Source employer and live/fixture identity are immutable.",
        );
      if (
        !existing &&
        Number(
          (
            await tx.query("SELECT COUNT(*) AS count FROM sources WHERE owner_id=$1", [
              this.ownerId,
            ])
          )[0]?.count,
        ) >= 50
      )
        throw new DomainError("CONFIG_INVALID", "Source limit reached.");
      const id = existing ? String(existing.id) : randomUUID();
      const revision = input.expectedRevision + 1;
      const policy = { ...input, id, expectedRevision: revision };
      await tx.query(
        "INSERT INTO sources(id,owner_id,connector,policy,state,source_key,revision,next_poll_at) VALUES($1,$2,$3,$4,'waiting',$5,$6,$7) ON CONFLICT(owner_id,id) DO UPDATE SET policy=excluded.policy,revision=excluded.revision,lease_token=NULL,lease_until=NULL",
        [
          id,
          this.ownerId,
          input.connector,
          JSON.stringify(policy),
          sourceKey(input),
          revision,
          this.now(),
        ],
      );
      await this.audit(tx, id, "source.configured", revision, {}, `owner:${this.ownerId}`);
      return sourceFrom(
        (
          await tx.query("SELECT * FROM sources WHERE owner_id=$1 AND id=$2", [this.ownerId, id])
        )[0] as Row,
      );
    });
  }
  async schedule(id: string, acknowledgeQuality = false) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM sources WHERE owner_id=$1 AND id=$2", [this.ownerId, id])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Source not found.");
      if (row.state === "rate_limited" && String(row.next_poll_at) > this.now())
        throw new DomainError("RATE_LIMITED", "Source backoff has not elapsed.");
      if (
        row.last_attempt_at &&
        this.clock().getTime() - Date.parse(String(row.last_attempt_at)) < 60000
      )
        throw new DomainError("RATE_LIMITED", "Manual polls must be at least one minute apart.");
      await tx.query(
        "UPDATE sources SET next_poll_at=$1,state='waiting',etag=NULL,job_count=$2,revision=revision+1,lease_token=NULL,lease_until=NULL WHERE owner_id=$3 AND id=$4",
        [
          this.now(),
          acknowledgeQuality ? Number(row.pending_count) : Number(row.job_count),
          this.ownerId,
          id,
        ],
      );
      await this.audit(
        tx,
        id,
        "source.scheduled",
        Number(row.revision) + 1,
        { acknowledged: acknowledgeQuality ? 1 : 0 },
        `owner:${this.ownerId}`,
      );
    });
  }
  async claimSource(): Promise<DiscoverySource | null> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const control = await this.readControl(tx);
      if (control.stopped || control.discoveryPaused || control.restoreBlocked) return null;
      const rows = await tx.query(
        "SELECT * FROM sources WHERE owner_id=$1 AND next_poll_at <= $2 AND (lease_until IS NULL OR lease_until <= $2) AND state <> 'forbidden' ORDER BY next_poll_at,id",
        [this.ownerId, this.now()],
      );
      const row = rows.find((r) => sourceFrom(r).enabled);
      if (!row) return null;
      const token = randomUUID();
      const until = new Date(this.clock().getTime() + 90000).toISOString();
      const claimed = await tx.query(
        "UPDATE sources SET lease_token=$1,lease_until=$2,last_attempt_at=$3 WHERE owner_id=$4 AND id=$5 RETURNING *",
        [token, until, this.now(), this.ownerId, String(row.id)],
      );
      return sourceFrom(claimed[0] as Row);
    });
  }
  private async held(tx: SqlExecutor, source: DiscoverySource): Promise<DiscoverySource> {
    const row = (
      await tx.query("SELECT * FROM sources WHERE owner_id=$1 AND id=$2", [this.ownerId, source.id])
    )[0];
    if (
      !row ||
      !source.leaseToken ||
      row.lease_token !== source.leaseToken ||
      String(row.lease_until) <= this.now()
    )
      throw new DomainError("LEASE_STALE", "Source poll lease expired or was replaced.");
    const control = await this.readControl(tx);
    if (control.stopped || control.discoveryPaused || control.restoreBlocked)
      throw new DomainError("TASK_CANCELLED", "Discovery was paused.");
    return sourceFrom(row);
  }
  private async recordRun(
    tx: SqlExecutor,
    source: DiscoverySource,
    health: SourceHealth,
    count: number,
    warnings: string[],
    pages: SourcePage[],
  ) {
    const id = randomUUID();
    await tx.query(
      "INSERT INTO source_runs(owner_id,id,source_id,started_at,completed_at,health,job_count,duration_ms,warnings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        this.ownerId,
        id,
        source.id,
        source.lastAttemptAt ?? this.now(),
        this.now(),
        health,
        count,
        Math.max(0, this.clock().getTime() - Date.parse(source.lastAttemptAt ?? this.now())),
        JSON.stringify(warnings.slice(0, 200)),
      ],
    );
    for (const [index, page] of pages.entries())
      await tx.query(
        "INSERT INTO source_pages(owner_id,run_id,page_number,data) VALUES($1,$2,$3,$4)",
        [this.ownerId, id, index, JSON.stringify(page)],
      );
    return id;
  }
  async failSource(
    source: DiscoverySource,
    health: SourceHealth,
    retryAfterMs: number,
    pages: SourcePage[] = [],
  ) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const current = await this.held(tx, source);
      const wait = Math.max(
        retryAfterMs,
        Math.min(86400000, 60000 * 2 ** Math.min(current.failures, 10)),
      );
      await this.recordRun(tx, source, health, 0, [health], pages);
      await tx.query(
        "UPDATE sources SET state=$1,failures=failures+1,next_poll_at=$2,lease_token=NULL,lease_until=NULL WHERE owner_id=$3 AND id=$4",
        [health, new Date(this.clock().getTime() + wait).toISOString(), this.ownerId, source.id],
      );
      await this.audit(tx, source.id, "source.poll_failed", source.revision, { health });
      await this.pruneRuns(tx, source.id);
    });
  }
  private async pruneRuns(tx: SqlExecutor, sourceId: string) {
    const old = await tx.query(
      "SELECT id FROM source_runs WHERE owner_id=$1 AND source_id=$2 ORDER BY completed_at DESC,id DESC LIMIT 10000 OFFSET 20",
      [this.ownerId, sourceId],
    );
    for (const r of old) {
      if (
        (
          await tx.query(
            "SELECT id FROM discovery_listings WHERE owner_id=$1 AND last_run_id=$2 LIMIT 1",
            [this.ownerId, String(r.id)],
          )
        ).length
      )
        continue;
      await tx.query("DELETE FROM source_pages WHERE owner_id=$1 AND run_id=$2", [
        this.ownerId,
        String(r.id),
      ]);
      await tx.query("DELETE FROM source_runs WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        String(r.id),
      ]);
    }
  }
  async ingest(source: DiscoverySource, batch: DiscoveryBatch) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const current = await this.held(tx, source);
      if (batch.notModified) {
        if (!current.etag)
          throw new DomainError("STATE_INVALID", "Unsolicited source revalidation.");
        const runId = await this.recordRun(tx, source, "healthy", current.count, [], batch.pages);
        await tx.query(
          "UPDATE discovery_listings SET last_seen_at=$1 WHERE owner_id=$2 AND source_id=$3 AND state='open'",
          [this.now(), this.ownerId, source.id],
        );
        await tx.query(
          "UPDATE discovery_listings SET state='closed',missing_count=missing_count+1 WHERE owner_id=$1 AND source_id=$2 AND state='missing' AND missing_since <= $3",
          [this.ownerId, source.id, new Date(this.clock().getTime() - 86400000).toISOString()],
        );
        await tx.query(
          "UPDATE sources SET state='healthy',last_success_at=$1,failures=0,next_poll_at=$2,lease_token=NULL,lease_until=NULL WHERE owner_id=$3 AND id=$4",
          [
            this.now(),
            new Date(this.clock().getTime() + source.intervalSeconds * 1000).toISOString(),
            this.ownerId,
            source.id,
          ],
        );
        await this.pruneRuns(tx, source.id);
        return runId;
      }
      const warnings = [...batch.warnings];
      const countDropped =
        (current.count >= 10 && batch.jobs.length < current.count / 2) ||
        (current.count > 0 && !batch.jobs.length);
      if (countDropped)
        warnings.push("Job count dropped sharply; prior vacancies retained until review.");
      const health = warnings.length ? "quality_warning" : "healthy";
      const runId = await this.recordRun(
        tx,
        source,
        health,
        batch.jobs.length,
        warnings,
        batch.pages,
      );
      if (!countDropped) {
        const seen = new Set<string>();
        for (const raw of batch.jobs) {
          const job = normalizedJobSchema.parse(raw);
          if (job.employerId !== source.employerId || job.synthetic !== (source.mode === "fixture"))
            throw new DomainError("CONFIG_INVALID", "Source ownership mismatch.");
          if (seen.has(job.postingId))
            throw new DomainError("CONFIG_INVALID", "Duplicate source posting.");
          seen.add(job.postingId);
          const previous = (
            await tx.query(
              "SELECT * FROM discovery_listings WHERE owner_id=$1 AND source_id=$2 AND posting_id=$3",
              [this.ownerId, source.id, job.postingId],
            )
          )[0];
          const same = (
            await tx.query(
              "SELECT * FROM jobs WHERE owner_id=$1 AND employer_id=$2 AND requisition_id=$3",
              [this.ownerId, job.employerId, job.requisitionId],
            )
          )[0];
          const originalId = same ? String(same.id) : job.id;
          const jobId = (
            await jobIdentity(tx, this.ownerId, previous ? String(previous.job_id) : originalId)
          ).canonical;
          const base = jobInputSchema.parse(
            Object.fromEntries(
              Object.keys(jobInputSchema.shape)
                .filter((key) => key in job)
                .map((key) => [key, job[key as keyof NormalizedJob]]),
            ),
          );
          await tx.query(
            "INSERT INTO jobs(id,owner_id,employer_id,requisition_id,data,created_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(owner_id,id) DO UPDATE SET data=excluded.data,last_seen_at=excluded.last_seen_at",
            [
              originalId,
              this.ownerId,
              job.employerId,
              job.requisitionId,
              JSON.stringify({ ...base, id: originalId }),
              this.now(),
            ],
          );
          const listingId = previous ? String(previous.id) : randomUUID();
          await tx.query(
            "INSERT INTO discovery_listings(owner_id,id,source_id,posting_id,job_id,original_job_id,canonical_url,data,state,first_seen_at,last_seen_at,last_run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$9,$10) ON CONFLICT(owner_id,id) DO UPDATE SET data=excluded.data,state='open',last_seen_at=excluded.last_seen_at,last_run_id=excluded.last_run_id,missing_since=NULL,missing_count=0",
            [
              this.ownerId,
              listingId,
              source.id,
              job.postingId,
              jobId,
              originalId,
              job.canonicalUrl,
              JSON.stringify({ ...job, id: jobId }),
              this.now(),
              runId,
            ],
          );
          await tx.query(
            "UPDATE historical_records SET job_id=$1 WHERE owner_id=$2 AND canonical_url=$3",
            [jobId, this.ownerId, job.canonicalUrl],
          );
          await this.applyHistory(tx, jobId);
        }
        if (!batch.warnings.length)
          for (const old of await tx.query(
            "SELECT * FROM discovery_listings WHERE owner_id=$1 AND source_id=$2 AND state <> 'closed'",
            [this.ownerId, source.id],
          )) {
            if (seen.has(String(old.posting_id))) continue;
            const since = old.missing_since ? String(old.missing_since) : this.now();
            const closed =
              Number(old.missing_count) >= 1 &&
              this.clock().getTime() - Date.parse(since) >= 86400000;
            await tx.query(
              "UPDATE discovery_listings SET state=$1,missing_since=$2,missing_count=missing_count+1 WHERE owner_id=$3 AND id=$4",
              [closed ? "closed" : "missing", since, this.ownerId, String(old.id)],
            );
          }
      }
      await tx.query(
        "UPDATE sources SET state=$1,job_count=$2,pending_count=$3,last_success_at=$4,failures=0,etag=$5,next_poll_at=$6,lease_token=NULL,lease_until=NULL WHERE owner_id=$7 AND id=$8",
        [
          health,
          countDropped ? current.count : batch.jobs.length,
          batch.jobs.length,
          countDropped ? current.lastSuccessAt : this.now(),
          countDropped ? null : batch.etag,
          new Date(this.clock().getTime() + source.intervalSeconds * 1000).toISOString(),
          this.ownerId,
          source.id,
        ],
      );
      await this.audit(tx, source.id, "source.polled", source.revision, {
        count: batch.jobs.length,
        health,
      });
      await this.pruneRuns(tx, source.id);
      return runId;
    });
  }
  private async candidateId(tx: SqlExecutor) {
    const row = (await tx.query("SELECT id FROM candidates WHERE owner_id=$1", [this.ownerId]))[0];
    if (!row) throw new DomainError("NOT_FOUND", "Candidate not initialized.");
    return String(row.id);
  }
  private async applyHistory(tx: SqlExecutor, jobId: string) {
    const records = await tx.query(
      "SELECT data FROM historical_records WHERE owner_id=$1 AND job_id=$2",
      [this.ownerId, jobId],
    );
    if (!records.some((r) => historyRecordSchema.parse(JSON.parse(String(r.data))).submitted))
      return;
    const candidate = await this.candidateId(tx);
    for (const member of (await jobIdentity(tx, this.ownerId, jobId)).members) {
      const submitted = await tx.query(
        "SELECT state FROM applications WHERE owner_id=$1 AND candidate_id=$2 AND job_id=$3",
        [this.ownerId, candidate, member],
      );
      if (submitted.some((a) => protectedStates.includes(String(a.state)))) return;
    }
    const existing = (
      await tx.query(
        "SELECT * FROM applications WHERE owner_id=$1 AND candidate_id=$2 AND job_id=$3",
        [this.ownerId, candidate, jobId],
      )
    )[0];
    if (existing && protectedStates.includes(String(existing.state))) return;
    if (
      existing &&
      (
        await tx.query("SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 LIMIT 1", [
          this.ownerId,
          String(existing.id),
        ])
      ).length
    )
      throw new DomainError(
        "STATE_INVALID",
        "Application attempts require reconciliation before historical changes.",
      );
    const id = existing ? String(existing.id) : randomUUID();
    await tx.query(
      "INSERT INTO applications(id,owner_id,candidate_id,job_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,'HISTORICAL_SUBMITTED',$5,$5) ON CONFLICT(owner_id,candidate_id,job_id) DO UPDATE SET state='HISTORICAL_SUBMITTED',revision=applications.revision+1,updated_at=excluded.updated_at",
      [id, this.ownerId, candidate, jobId, this.now()],
    );
    await tx.query(
      "UPDATE tasks SET state='cancelled',lease_owner=NULL,lease_until=NULL,last_error='DUPLICATE_CONFIRMED' WHERE owner_id=$1 AND application_id=$2 AND state IN ('queued','leased')",
      [this.ownerId, id],
    );
    await this.audit(
      tx,
      id,
      "application.historical_assertion",
      Number(existing?.revision ?? 0) + 1,
      {},
      `owner:${this.ownerId}`,
    );
  }
  async importHistory(records: HistoryRecord[]) {
    if (records.length > 2000)
      throw new DomainError("CONFIG_INVALID", "History record limit exceeded.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      let imported = 0;
      const existingCount = Number(
        (
          await tx.query("SELECT COUNT(*) AS count FROM historical_records WHERE owner_id=$1", [
            this.ownerId,
          ])
        )[0]?.count,
      );
      for (const raw of records) {
        const record = historyRecordSchema.parse(raw);
        if (record.submittedOn && record.submittedOn > this.now().slice(0, 10))
          throw new DomainError("CONFIG_INVALID", "Historical submission date is in the future.");
        const canonicalUrl = recognizeUrl(record.url).canonicalUrl;
        const content = JSON.stringify(record);
        const sha = digest(content);
        const old = (
          await tx.query(
            "SELECT sha256 FROM historical_records WHERE owner_id=$1 AND external_id=$2",
            [this.ownerId, record.externalId],
          )
        )[0];
        if (old) {
          if (old.sha256 !== sha)
            throw new DomainError(
              "REVISION_STALE",
              "Historical external ID already has different content.",
            );
          continue;
        }
        if (existingCount + imported >= 2000)
          throw new DomainError("CONFIG_INVALID", "Historical record capacity reached.");
        const listing = (
          await tx.query(
            "SELECT job_id FROM discovery_listings WHERE owner_id=$1 AND canonical_url=$2",
            [this.ownerId, canonicalUrl],
          )
        )[0];
        const id = randomUUID();
        const jobId = listing ? String(listing.job_id) : null;
        await tx.query(
          "INSERT INTO historical_records(owner_id,id,external_id,canonical_url,job_id,data,sha256,imported_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [this.ownerId, id, record.externalId, canonicalUrl, jobId, content, sha, this.now()],
        );
        if (jobId) await this.applyHistory(tx, jobId);
        await this.audit(
          tx,
          id,
          "history.imported",
          1,
          { submitted: record.submitted ? 1 : 0 },
          `owner:${this.ownerId}`,
        );
        imported++;
      }
      return { imported, unchanged: records.length - imported };
    });
  }
  async evidence(runId: string) {
    const run = (
      await this.db.query("SELECT * FROM source_runs WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        runId,
      ])
    )[0];
    if (!run) throw new DomainError("NOT_FOUND", "Source run not found.");
    return {
      run: runFrom(run),
      pages: (
        await this.db.query(
          "SELECT data FROM source_pages WHERE owner_id=$1 AND run_id=$2 ORDER BY page_number",
          [this.ownerId, runId],
        )
      ).map((r) => {
        const page = JSON.parse(String(r.data)) as SourcePage;
        return {
          url: page.url,
          status: page.status,
          sha256: page.sha256,
          etag: page.etag,
          fetchedAt: page.fetchedAt,
        };
      }),
    };
  }
  async mergeJobs(from: string, to: string, reason: string) {
    if (!reason.trim() || reason.length > 2000 || from === to)
      throw new DomainError(
        "CONFIG_INVALID",
        "Distinct jobs and an identity explanation are required.",
      );
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const left = await jobIdentity(tx, this.ownerId, from);
      const right = await jobIdentity(tx, this.ownerId, to);
      if (left.canonical !== from || right.canonical !== to || left.members.length > 1)
        throw new DomainError(
          "STATE_INVALID",
          "Split existing source resolutions before merging this group.",
        );
      const a = (
        await tx.query("SELECT * FROM jobs WHERE owner_id=$1 AND id=$2", [this.ownerId, from])
      )[0];
      const b = (
        await tx.query("SELECT * FROM jobs WHERE owner_id=$1 AND id=$2", [this.ownerId, to])
      )[0];
      if (!a || !b) throw new DomainError("NOT_FOUND", "Both jobs must exist in this workspace.");
      if (a.employer_id !== b.employer_id)
        throw new DomainError(
          "CONFIG_INVALID",
          "Employer identities differ; do not merge unrelated employers.",
        );
      const applications: Row[] = [];
      for (const member of [from, ...right.members])
        applications.push(
          ...(await tx.query(
            "SELECT * FROM applications WHERE owner_id=$1 AND job_id=$2 AND state <> 'DUPLICATE'",
            [this.ownerId, member],
          )),
        );
      if (
        applications.some((app) =>
          ["IN_FLIGHT", "INTENT_RECORDED", "UNKNOWN", "RECONCILING", "NEEDS_REVIEW"].includes(
            String(app.state),
          ),
        )
      )
        throw new DomainError(
          "STATE_INVALID",
          "Reconcile uncertain submissions before resolving identity.",
        );
      const committed = applications.filter((a) =>
        ["CONFIRMED", "HISTORICAL_SUBMITTED"].includes(String(a.state)),
      );
      if (committed.length > 1)
        throw new DomainError(
          "STATE_INVALID",
          "Multiple submitted records require evidence review; no history was changed.",
        );
      const winner =
        committed[0] ??
        applications.sort(
          (a, b) =>
            String(a.created_at).localeCompare(String(b.created_at)) ||
            String(a.id).localeCompare(String(b.id)),
        )[0];
      for (const app of applications) {
        if (app.id === winner?.id) continue;
        await tx.query(
          "UPDATE applications SET state='DUPLICATE',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3",
          [this.now(), this.ownerId, String(app.id)],
        );
        await tx.query(
          "UPDATE tasks SET state='cancelled',lease_owner=NULL,lease_until=NULL,last_error='DUPLICATE_CONFIRMED' WHERE owner_id=$1 AND application_id=$2 AND state IN ('queued','leased')",
          [this.ownerId, String(app.id)],
        );
      }
      const id = randomUUID();
      await tx.query(
        "INSERT INTO identity_resolutions(owner_id,id,from_job_id,to_job_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [this.ownerId, id, from, to, reason.trim(), this.now()],
      );
      await tx.query("UPDATE discovery_listings SET job_id=$1 WHERE owner_id=$2 AND job_id=$3", [
        to,
        this.ownerId,
        from,
      ]);
      await tx.query("UPDATE historical_records SET job_id=$1 WHERE owner_id=$2 AND job_id=$3", [
        to,
        this.ownerId,
        from,
      ]);
      await this.audit(tx, id, "job.identity_merged", 1, { from, to }, `owner:${this.ownerId}`);
      return id;
    });
  }
  async splitJobs(id: string) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const resolution = (
        await tx.query("SELECT * FROM identity_resolutions WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          id,
        ])
      )[0];
      if (!resolution) throw new DomainError("NOT_FOUND", "Identity resolution not found.");
      if (resolution.reversed_at) return;
      const from = String(resolution.from_job_id);
      const to = String(resolution.to_job_id);
      for (const member of (await jobIdentity(tx, this.ownerId, to)).members) {
        const apps = await tx.query(
          "SELECT state FROM applications WHERE owner_id=$1 AND job_id=$2",
          [this.ownerId, member],
        );
        if (
          apps.some((a) =>
            ["IN_FLIGHT", "INTENT_RECORDED", "UNKNOWN", "RECONCILING", "NEEDS_REVIEW"].includes(
              String(a.state),
            ),
          )
        )
          throw new DomainError(
            "STATE_INVALID",
            "Reconcile uncertain submissions before splitting identity.",
          );
      }
      await tx.query("UPDATE identity_resolutions SET reversed_at=$1 WHERE owner_id=$2 AND id=$3", [
        this.now(),
        this.ownerId,
        id,
      ]);
      await tx.query(
        "UPDATE discovery_listings SET job_id=original_job_id WHERE owner_id=$1 AND original_job_id=$2",
        [this.ownerId, from],
      );
      await tx.query(
        "UPDATE historical_records SET job_id=$1 WHERE owner_id=$2 AND canonical_url IN (SELECT canonical_url FROM discovery_listings WHERE owner_id=$2 AND original_job_id=$1)",
        [from, this.ownerId],
      );
      await tx.query(
        "UPDATE applications SET state='NORMALIZED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND job_id=$3 AND state='DUPLICATE'",
        [this.now(), this.ownerId, from],
      );
      await this.applyHistory(tx, from);
      const remaining = await jobIdentity(tx, this.ownerId, to);
      const remainingApps: Row[] = [];
      for (const member of remaining.members)
        remainingApps.push(
          ...(await tx.query("SELECT * FROM applications WHERE owner_id=$1 AND job_id=$2", [
            this.ownerId,
            member,
          ])),
        );
      if (remainingApps.length && remainingApps.every((a) => a.state === "DUPLICATE")) {
        const restart = remainingApps.sort(
          (a, b) =>
            String(a.created_at).localeCompare(String(b.created_at)) ||
            String(a.id).localeCompare(String(b.id)),
        )[0];
        await tx.query(
          "UPDATE applications SET state='NORMALIZED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3",
          [this.now(), this.ownerId, String(restart?.id)],
        );
      }
      await this.applyHistory(tx, to);
      await this.audit(tx, id, "job.identity_split", 2, { from, to }, `owner:${this.ownerId}`);
    });
  }
}
