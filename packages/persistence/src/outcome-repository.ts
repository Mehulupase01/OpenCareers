import { createHash, randomUUID } from "node:crypto";
import { mailClassificationSchema } from "../../contracts/src/email.js";
import { DomainError } from "../../contracts/src/index.js";
import {
  type CohortReport,
  cohortInputSchema,
  type OutcomeEvent,
  outcomeInputSchema,
  outcomeKindSchema,
} from "../../contracts/src/outcome.js";
import { classifyCorrelatedOutcome } from "../../matching/src/outcome-classification.js";
import type { Row, SqlExecutor } from "./database.js";
import { OwnerScope } from "./owner-scope.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const outcomeEventFromRow = (row: Row): OutcomeEvent => ({
  id: String(row.id),
  applicationId: String(row.application_id),
  revision: Number(row.revision),
  kind: outcomeKindSchema.parse(row.kind),
  source: row.source as OutcomeEvent["source"],
  evidenceRef: String(row.evidence_ref),
  evidenceSha256: String(row.evidence_sha256),
  occurredAt: String(row.occurred_at),
  recordedAt: String(row.recorded_at),
  previousEventId: row.previous_event_id as string | null,
  actor: row.actor as OutcomeEvent["actor"],
});

export class OutcomeRepository extends OwnerScope {
  async history(applicationId: string) {
    if (
      !(
        await this.db.query("SELECT id FROM applications WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          applicationId,
        ])
      ).length
    )
      throw new DomainError("NOT_FOUND", "Application not found.");
    const rows = await this.db.query(
      "SELECT * FROM outcome_events WHERE owner_id=$1 AND application_id=$2 ORDER BY revision LIMIT 1001",
      [this.ownerId, applicationId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Outcome history exceeds the bounded read size.");
    return rows.map(outcomeEventFromRow);
  }
  private async append(
    tx: SqlExecutor,
    raw: unknown,
    source: OutcomeEvent["source"],
    actor: OutcomeEvent["actor"],
  ) {
    const input = outcomeInputSchema.parse(raw);
    const application = (
      await tx.query("SELECT created_at FROM applications WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        input.applicationId,
      ])
    )[0];
    if (!application) throw new DomainError("NOT_FOUND", "Application not found.");
    const occurred = Date.parse(input.occurredAt);
    if (occurred > this.clock().getTime() || occurred < Date.parse(String(application.created_at)))
      throw new DomainError(
        "STATE_INVALID",
        "Outcome evidence falls outside the application timeline.",
      );
    const binding = hash(JSON.stringify({ ...input, source, actor }));
    const existing = (
      await tx.query("SELECT * FROM outcome_events WHERE owner_id=$1 AND request_id=$2", [
        this.ownerId,
        input.requestId,
      ])
    )[0];
    if (existing) {
      if (existing.binding !== binding)
        throw new DomainError("REVISION_STALE", "Outcome request identity was already used.");
      return outcomeEventFromRow(existing);
    }
    const current = (
      await tx.query(
        "SELECT revision,event_id FROM application_outcomes WHERE owner_id=$1 AND application_id=$2",
        [this.ownerId, input.applicationId],
      )
    )[0];
    if (Number(current?.revision ?? 0) !== input.expectedRevision)
      throw new DomainError("REVISION_STALE", "Outcome revision changed.");
    const event: OutcomeEvent = {
      id: randomUUID(),
      applicationId: input.applicationId,
      revision: input.expectedRevision + 1,
      kind: input.kind,
      source,
      actor,
      evidenceRef: input.evidenceRef,
      evidenceSha256: input.evidenceSha256,
      occurredAt: new Date(occurred).toISOString(),
      recordedAt: this.now(),
      previousEventId: (current?.event_id as string) ?? null,
    };
    await tx.query(
      "INSERT INTO outcome_events(owner_id,id,application_id,revision,kind,source,actor,evidence_ref,evidence_sha256,occurred_at,recorded_at,previous_event_id,request_id,binding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        this.ownerId,
        event.id,
        event.applicationId,
        event.revision,
        event.kind,
        event.source,
        event.actor,
        event.evidenceRef,
        event.evidenceSha256,
        event.occurredAt,
        event.recordedAt,
        event.previousEventId,
        input.requestId,
        binding,
      ],
    );
    await tx.query(
      "INSERT INTO application_outcomes(owner_id,application_id,revision,event_id) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,application_id) DO UPDATE SET revision=excluded.revision,event_id=excluded.event_id",
      [this.ownerId, event.applicationId, event.revision, event.id],
    );
    await this.audit(
      tx,
      input.applicationId,
      "outcome.recorded",
      event.revision,
      { eventId: event.id, kind: event.kind, source },
      actor,
    );
    return event;
  }
  async recordOwner(raw: unknown) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      return this.append(tx, raw, "owner", "owner");
    });
  }
  async reverse(
    applicationId: string,
    eventId: string,
    expectedRevision: number,
    requestId: string,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const existing = (
        await tx.query("SELECT * FROM outcome_events WHERE owner_id=$1 AND request_id=$2", [
          this.ownerId,
          requestId,
        ])
      )[0];
      if (existing) {
        if (
          existing.source !== "reversal" ||
          existing.application_id !== applicationId ||
          existing.evidence_ref !== eventId ||
          Number(existing.revision) !== expectedRevision + 1
        )
          throw new DomainError("REVISION_STALE", "Reversal request identity was already used.");
        return outcomeEventFromRow(existing);
      }
      const prior = (
        await tx.query(
          "SELECT * FROM outcome_events WHERE owner_id=$1 AND application_id=$2 AND id=$3",
          [this.ownerId, applicationId, eventId],
        )
      )[0];
      if (!prior) throw new DomainError("NOT_FOUND", "Prior outcome not found.");
      return this.append(
        tx,
        {
          applicationId,
          expectedRevision,
          requestId,
          kind: prior.kind,
          evidenceRef: eventId,
          evidenceSha256: hash(JSON.stringify(outcomeEventFromRow(prior))),
          occurredAt: this.now(),
        },
        "reversal",
        "owner",
      );
    });
  }
  async recordMail(messageId: string) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      return this.recordMailInTransaction(tx, messageId);
    });
  }
  // Caller holds the owner lock; Gmail ingestion shares its existing transaction.
  async recordMailInTransaction(tx: SqlExecutor, messageId: string) {
    const row = (
      await tx.query("SELECT * FROM email_messages WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        messageId,
      ])
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Message not found.");
    const kind = classifyCorrelatedOutcome({
      classification: mailClassificationSchema.parse(row.classification),
      correlation: String(row.correlation),
      contextKind: row.context_kind as string | null,
    });
    if (kind === "UNKNOWN" || !row.context_id)
      return { status: "ignored" as const, kind: "UNKNOWN" as const };
    const application = (
      await tx.query("SELECT created_at FROM applications WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        row.context_id,
      ])
    )[0];
    if (
      !application ||
      Date.parse(String(row.received_at)) > this.clock().getTime() ||
      Date.parse(String(row.received_at)) < Date.parse(String(application.created_at))
    )
      return { status: "ignored" as const, kind: "UNKNOWN" as const };
    const prior = (
      await tx.query(
        "SELECT * FROM outcome_events WHERE owner_id=$1 AND source='email' AND evidence_ref=$2",
        [this.ownerId, messageId],
      )
    )[0];
    if (prior) return { status: "recorded" as const, event: outcomeEventFromRow(prior) };
    const current = (
      await tx.query(
        "SELECT e.* FROM application_outcomes o JOIN outcome_events e ON e.owner_id=o.owner_id AND e.id=o.event_id WHERE o.owner_id=$1 AND o.application_id=$2",
        [this.ownerId, row.context_id],
      )
    )[0];
    // Mail cannot overwrite an owner correction or newer evidence.
    if (
      current &&
      (current.source !== "email" ||
        Date.parse(String(current.occurred_at)) >= Date.parse(String(row.received_at)) ||
        (kind === "RECEIVED" && current.kind !== "UNKNOWN" && current.kind !== "RECEIVED"))
    )
      return { status: "ignored" as const, kind: "UNKNOWN" as const };
    return {
      status: "recorded" as const,
      event: await this.append(
        tx,
        {
          applicationId: row.context_id,
          expectedRevision: Number(current?.revision ?? 0),
          requestId: randomUUID(),
          kind,
          evidenceRef: messageId,
          evidenceSha256: row.sha256,
          occurredAt: row.received_at,
        },
        "email",
        "mail-correlator",
      ),
    };
  }
  async cohort(raw: unknown): Promise<CohortReport> {
    const input = cohortInputSchema.parse(raw);
    const from = Date.parse(input.from),
      through = Date.parse(input.through),
      asOf = Date.parse(input.asOf);
    if (from > through || through > asOf || asOf > this.clock().getTime())
      throw new DomainError("STATE_INVALID", "Invalid completed-cohort window.");
    const rows = await this.db.query(
      "SELECT a.id,a.state,j.data,r.received_at FROM applications a JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id LEFT JOIN (SELECT r.owner_id,r.application_id,MIN(r.observed_at) AS received_at FROM receipts r JOIN attempts t ON t.owner_id=r.owner_id AND t.id=r.attempt_id AND t.application_id=r.application_id WHERE t.state='CONFIRMED' GROUP BY r.owner_id,r.application_id) r ON r.owner_id=a.owner_id AND r.application_id=a.id WHERE a.owner_id=$1 ORDER BY a.id LIMIT 10001",
      [this.ownerId],
    );
    if (rows.length > 10000)
      throw new DomainError("STATE_INVALID", "Cohort exceeds the bounded report size.");
    const events = await this.db.query(
      "SELECT * FROM outcome_events WHERE owner_id=$1 AND recorded_at <= $2 AND occurred_at <= $2 ORDER BY revision LIMIT 100001",
      [this.ownerId, new Date(asOf).toISOString()],
    );
    if (events.length > 100000)
      throw new DomainError(
        "STATE_INVALID",
        "Cohort event history exceeds the bounded report size.",
      );
    const latest = new Map<string, string>();
    for (const event of events) latest.set(String(event.application_id), String(event.kind));
    const exclusions = {
      synthetic: 0,
      unverified: 0,
      outsideWindow: 0,
      stillObserving: 0,
      duplicate: 0,
      unresolved: 0,
    };
    const counts: Record<string, number> = {};
    let denominator = 0;
    for (const row of rows) {
      const job = JSON.parse(String(row.data));
      if (job.synthetic !== false) {
        exclusions.synthetic++;
        continue;
      }
      if (row.state === "DUPLICATE") {
        exclusions.duplicate++;
        continue;
      }
      if (!row.received_at) {
        exclusions.unverified++;
        continue;
      }
      if (row.state !== "CONFIRMED") {
        exclusions.unresolved++;
        continue;
      }
      const received = Date.parse(String(row.received_at));
      if (received < from || received > through) {
        exclusions.outsideWindow++;
        continue;
      }
      if (received + input.observationDays * 86400000 > asOf) {
        exclusions.stillObserving++;
        continue;
      }
      denominator++;
      const kind = latest.get(String(row.id)) ?? "UNKNOWN";
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return {
      status: denominator >= input.minimumSample ? "measured" : "insufficient_data",
      methodology:
        "current_recorded_outcome_fraction_among_mature_receipt_verified_live_applications",
      advisoryOnly: true,
      window: input,
      denominator,
      counts,
      exclusions,
      fractions:
        denominator >= input.minimumSample
          ? Object.fromEntries(
              Object.entries(counts).map(([kind, numerator]) => [
                kind,
                { numerator, denominator, fraction: numerator / denominator },
              ]),
            )
          : null,
    };
  }
}
