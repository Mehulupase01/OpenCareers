import { createHash } from "node:crypto";
import { z } from "zod";
import { cumulativeEvidenceSchema, cumulativeMilestoneSchema } from "../../contracts/src/cohort.js";
import { DomainError, idSchema } from "../../contracts/src/index.js";
import { type OutcomeEvent, outcomeKindSchema } from "../../contracts/src/outcome.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const eventSchema = z
  .object({
    id: idSchema,
    applicationId: idSchema,
    revision: z.number().int().positive(),
    kind: outcomeKindSchema,
    source: z.enum(["owner", "email", "reversal"]),
    actor: z.enum(["owner", "mail-correlator"]),
    evidenceRef: idSchema,
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    occurredAt: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
    previousEventId: idSchema.nullable(),
  })
  .strict();

export function captureCumulativeEvidence(
  events: OutcomeEvent[],
  applicationId: string,
  createdAt: string,
  horizon: string,
  asOf: string,
) {
  if (
    ![createdAt, horizon, asOf].every((value) => z.iso.datetime().safeParse(value).success) ||
    Date.parse(createdAt) > Date.parse(horizon) ||
    Date.parse(horizon) > Date.parse(asOf)
  )
    throw new DomainError("STATE_INVALID", "Cumulative outcome observation window is invalid.");
  if (events.length > 1000)
    throw new DomainError("STATE_INVALID", "Cumulative outcome history exceeds its bound.");
  const byId = new Map<string, OutcomeEvent>();
  let previous: OutcomeEvent | undefined;
  for (const event of events) {
    if (
      !eventSchema.safeParse(event).success ||
      event.applicationId !== applicationId ||
      byId.has(event.id) ||
      event.revision !== (previous?.revision ?? 0) + 1 ||
      event.previousEventId !== (previous?.id ?? null) ||
      Date.parse(event.occurredAt) < Date.parse(createdAt) ||
      Date.parse(event.occurredAt) > Date.parse(event.recordedAt) ||
      Date.parse(event.recordedAt) > Date.parse(asOf) ||
      (previous && Date.parse(event.recordedAt) < Date.parse(previous.recordedAt)) ||
      (event.source === "email" ? event.actor !== "mail-correlator" : event.actor !== "owner")
    )
      throw new DomainError("STATE_INVALID", "Cumulative outcome history integrity failed.");
    if (event.source === "reversal") {
      const target = byId.get(event.evidenceRef);
      if (!target || event.kind !== target.kind || event.evidenceSha256 !== hash(target))
        throw new DomainError(
          "STATE_INVALID",
          "Cumulative outcome restoration evidence is invalid.",
        );
    }
    byId.set(event.id, event);
    previous = event;
  }
  const eligible = (event: OutcomeEvent) => Date.parse(event.occurredAt) <= Date.parse(horizon);
  const branch: OutcomeEvent[] = [];
  let cursor = events.filter(eligible).at(-1);
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id))
      throw new DomainError("STATE_INVALID", "Cumulative outcome history cycle.");
    seen.add(cursor.id);
    const included = eligible(cursor);
    if (included) branch.push(cursor);
    const next =
      included && cursor.source === "reversal" ? cursor.evidenceRef : cursor.previousEventId;
    cursor = next ? byId.get(next) : undefined;
  }
  const milestones = new Map<
    string,
    z.infer<typeof cumulativeEvidenceSchema>["milestones"][number]
  >();
  for (const event of branch.reverse()) {
    // UNKNOWN is a conservative evidence reset, not an inferred rejection.
    if (event.kind === "UNKNOWN") milestones.clear();
    if (event.source === "reversal" || !cumulativeMilestoneSchema.safeParse(event.kind).success)
      continue;
    const prior = milestones.get(event.kind);
    if (!prior || Date.parse(event.occurredAt) < Date.parse(prior.occurredAt))
      milestones.set(event.kind, {
        kind: cumulativeMilestoneSchema.parse(event.kind),
        eventId: event.id,
        revision: event.revision,
        evidenceSha256: event.evidenceSha256,
        occurredAt: event.occurredAt,
      });
  }
  return cumulativeEvidenceSchema.parse({
    historySha256: hash(
      events.map(
        ({
          id,
          revision,
          kind,
          source,
          evidenceSha256,
          occurredAt,
          recordedAt,
          previousEventId,
          evidenceRef,
        }) => ({
          id,
          revision,
          kind,
          source,
          evidenceSha256,
          occurredAt,
          recordedAt,
          previousEventId,
          restoredEventId: source === "reversal" ? evidenceRef : null,
        }),
      ),
    ),
    milestones: [...milestones.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
  });
}
