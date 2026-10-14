import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError } from "../../packages/contracts/src/index.js";
import type { OutcomeEvent, OutcomeKind } from "../../packages/contracts/src/outcome.js";
import { captureCumulativeEvidence } from "../../packages/persistence/src/cohort-history.js";
import { outcomeEventFromRow } from "../../packages/persistence/src/outcome-repository.js";

const applicationId = "synthetic-application";
const createdAt = "2026-08-01T00:00:00.000Z";
const horizon = "2026-08-20T00:00:00.000Z";
const asOf = "2026-09-01T00:00:00.000Z";
const at = (day: number) => `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function append(
  events: OutcomeEvent[],
  kind: OutcomeKind,
  overrides: Partial<OutcomeEvent> = {},
): OutcomeEvent {
  const revision = events.length + 1;
  const event = {
    id: `synthetic-event-${revision}`,
    applicationId,
    revision,
    kind,
    source: "owner" as const,
    actor: "owner" as const,
    evidenceRef: `synthetic-evidence-${revision}`,
    evidenceSha256: digest(`synthetic-evidence-${revision}`),
    occurredAt: at(revision + 1),
    recordedAt: at(revision + 1),
    previousEventId: events.at(-1)?.id ?? null,
    ...overrides,
  };
  // Reproduce persisted decoder order: restoration hashes bind these exact JSON bytes.
  const decoded = outcomeEventFromRow({
    id: event.id,
    application_id: event.applicationId,
    revision: event.revision,
    kind: event.kind,
    source: event.source,
    actor: event.actor,
    evidence_ref: event.evidenceRef,
    evidence_sha256: event.evidenceSha256,
    occurred_at: event.occurredAt,
    recorded_at: event.recordedAt,
    previous_event_id: event.previousEventId,
  });
  events.push(decoded);
  return decoded;
}

function restore(
  events: OutcomeEvent[],
  target: OutcomeEvent,
  overrides: Partial<OutcomeEvent> = {},
) {
  return append(events, target.kind, {
    source: "reversal",
    evidenceRef: target.id,
    evidenceSha256: digest(target),
    ...overrides,
  });
}

const capture = (events: OutcomeEvent[]) =>
  captureCumulativeEvidence(events, applicationId, createdAt, horizon, asOf);
const milestone = (event: OutcomeEvent) => ({
  kind: event.kind,
  eventId: event.id,
  revision: event.revision,
  evidenceSha256: event.evidenceSha256,
  occurredAt: event.occurredAt,
});
const milestones = (...events: OutcomeEvent[]) =>
  events.map(milestone).sort((left, right) => left.kind.localeCompare(right.kind));

function expectInvalid(events: OutcomeEvent[]) {
  expect(() => capture(events)).toThrow(DomainError);
  expect(() => capture(events)).toThrow(expect.objectContaining({ code: "STATE_INVALID" }));
}

describe("correction-aware cumulative outcome history", () => {
  it("refuses malformed and reversed observation windows even when there are no events", () => {
    for (const dates of [
      ["not-a-date", horizon, asOf],
      [createdAt, "not-a-date", asOf],
      [createdAt, horizon, "not-a-date"],
      [horizon, createdAt, asOf],
      [createdAt, asOf, horizon],
    ]) {
      expect(() =>
        captureCumulativeEvidence(
          [],
          applicationId,
          dates[0] as string,
          dates[1] as string,
          dates[2] as string,
        ),
      ).toThrow("observation window");
    }
  });
  it("captures empty histories deterministically without inferred stages", () => {
    expect(capture([])).toEqual({ historySha256: digest([]), milestones: [] });
    const events: OutcomeEvent[] = [];
    append(events, "RECEIVED");
    expect(capture(events).milestones).toEqual([]);
  });

  it("retains exact positive evidence across rejection and withdrawal", () => {
    const events: OutcomeEvent[] = [];
    const screening = append(events, "SCREENING");
    const interview = append(events, "INTERVIEW", { source: "email", actor: "mail-correlator" });
    append(events, "REJECTION");
    expect(capture(events).milestones).toEqual(milestones(screening, interview));
    const offer = append(events, "OFFER");
    append(events, "WITHDRAWN");
    expect(capture(events).milestones).toEqual(milestones(screening, interview, offer));
  });

  it("does not infer screening or interview from an offer", () => {
    const events: OutcomeEvent[] = [];
    const offer = append(events, "OFFER");
    expect(capture(events).milestones).toEqual([milestone(offer)]);
  });

  it("deduplicates stages using earliest occurrence, with revision as the stable tie", () => {
    const events: OutcomeEvent[] = [];
    append(events, "INTERVIEW", { occurredAt: at(5), recordedAt: at(5) });
    const earliest = append(events, "INTERVIEW", { occurredAt: at(3), recordedAt: at(6) });
    append(events, "INTERVIEW", { occurredAt: at(3), recordedAt: at(7) });
    expect(capture(events).milestones).toEqual([milestone(earliest)]);
  });

  it("UNKNOWN clears earlier evidence but allows explicit new positive evidence", () => {
    const events: OutcomeEvent[] = [];
    append(events, "SCREENING");
    append(events, "INTERVIEW");
    append(events, "UNKNOWN");
    expect(capture(events).milestones).toEqual([]);
    const offer = append(events, "OFFER");
    expect(capture(events).milestones).toEqual([milestone(offer)]);
  });

  it("rebases restoration and can redo an abandoned branch without new milestones", () => {
    const events: OutcomeEvent[] = [];
    const screening = append(events, "SCREENING");
    const interview = append(events, "INTERVIEW");
    const offer = append(events, "OFFER");
    const rollback = restore(events, screening);
    expect(capture(events).milestones).toEqual([milestone(screening)]);
    const alternate = append(events, "INTERVIEW");
    expect(capture(events).milestones).toEqual(milestones(screening, alternate));
    restore(events, offer);
    expect(capture(events).milestones).toEqual(milestones(screening, interview, offer));
    restore(events, rollback);
    expect(capture(events).milestones).toEqual([milestone(screening)]);
  });

  it("can restore positive evidence abandoned by UNKNOWN", () => {
    const events: OutcomeEvent[] = [];
    const interview = append(events, "INTERVIEW");
    append(events, "UNKNOWN");
    restore(events, interview);
    expect(capture(events).milestones).toEqual([milestone(interview)]);
  });

  it("does not apply evidence or a reversal occurring after the inclusive horizon", () => {
    const events: OutcomeEvent[] = [];
    const screening = append(events, "SCREENING");
    const interview = append(events, "INTERVIEW", { occurredAt: horizon, recordedAt: horizon });
    const before = capture(events);
    append(events, "OFFER", { occurredAt: at(21), recordedAt: at(21) });
    restore(events, screening, { occurredAt: at(22), recordedAt: at(22) });
    expect(capture(events).milestones).toEqual(milestones(screening, interview));
    expect(capture(events).historySha256).not.toBe(before.historySha256);
  });

  it("includes pre-horizon evidence recorded later, but only through asOf", () => {
    const events: OutcomeEvent[] = [];
    const interview = append(events, "INTERVIEW", { occurredAt: at(19), recordedAt: asOf });
    expect(capture(events).milestones).toEqual([milestone(interview)]);
    expect(() =>
      captureCumulativeEvidence(events, applicationId, createdAt, horizon, at(31)),
    ).toThrow(DomainError);
  });

  it("skips a late event when traversing a later-recorded eligible branch", () => {
    const events: OutcomeEvent[] = [];
    const screening = append(events, "SCREENING");
    append(events, "UNKNOWN", { occurredAt: at(21), recordedAt: at(21) });
    const interview = append(events, "INTERVIEW", { occurredAt: at(19), recordedAt: at(22) });
    expect(capture(events).milestones).toEqual(milestones(screening, interview));
  });

  it("does not follow a post-horizon reversal from later-recorded pre-horizon evidence", () => {
    const events: OutcomeEvent[] = [];
    const screening = append(events, "SCREENING");
    const interview = append(events, "INTERVIEW");
    restore(events, screening, { occurredAt: at(21), recordedAt: at(21) });
    const offer = append(events, "OFFER", { occurredAt: at(19), recordedAt: at(22) });
    expect(capture(events).milestones).toEqual(milestones(screening, interview, offer));
  });

  it("hashes the complete validated history without mutating decoder objects", () => {
    const events: OutcomeEvent[] = [];
    const screening = append(events, "SCREENING");
    append(events, "INTERVIEW");
    restore(events, screening);
    const before = JSON.stringify(events);
    const result = capture(events);
    expect(result.historySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(capture(events)).toEqual(result);
    expect(JSON.stringify(events)).toBe(before);
    const changed = events.map((event, index) =>
      index === 1 ? { ...event, evidenceSha256: "f".repeat(64) } : event,
    );
    expect(capture(changed).milestones).toEqual(result.milestones);
    expect(capture(changed).historySha256).not.toBe(result.historySha256);
  });

  it.each<[string, Partial<OutcomeEvent>]>([
    ["wrong application owner scope", { applicationId: "another-synthetic-application" }],
    ["revision gap", { revision: 3 }],
    ["fractional revision", { revision: 1.5 }],
    ["wrong previous link", { previousEventId: "missing-event" }],
    ["self link cycle", { previousEventId: "synthetic-event-2" }],
    ["duplicate identity", { id: "synthetic-event-1" }],
    ["pre-application occurrence", { occurredAt: "2026-07-31T00:00:00.000Z" }],
    ["occurrence after recording", { occurredAt: at(4) }],
    ["recording after asOf", { recordedAt: "2026-09-02T00:00:00.000Z" }],
    ["regressing recording time", { occurredAt: createdAt, recordedAt: createdAt }],
    ["invalid timestamp", { occurredAt: "not-a-date" }],
    ["invalid evidence digest", { evidenceSha256: "bad-digest" }],
    ["owner source with mail actor", { actor: "mail-correlator" }],
    ["email source with owner actor", { source: "email" }],
    ["reversal with mail actor", { source: "reversal", actor: "mail-correlator" }],
  ])("rejects %s", (_label, overrides) => {
    const events: OutcomeEvent[] = [];
    append(events, "SCREENING");
    append(events, "INTERVIEW");
    Object.assign(events[1] as OutcomeEvent, overrides);
    expectInvalid(events);
  });

  it("rejects missing first revisions, missing middle events, and unordered input", () => {
    const events: OutcomeEvent[] = [];
    append(events, "SCREENING");
    append(events, "INTERVIEW");
    append(events, "OFFER");
    expectInvalid(events.slice(1));
    expectInvalid(events.filter((event) => event.revision !== 2));
    expectInvalid([...events].reverse());
  });

  it.each<[string, Partial<OutcomeEvent>]>([
    ["missing target", { evidenceRef: "missing-target" }],
    ["self-target cycle", { evidenceRef: "synthetic-event-3" }],
    ["future target", { evidenceRef: "synthetic-event-4" }],
    ["wrong target kind", { kind: "OFFER" }],
    ["wrong target digest", { evidenceSha256: "0".repeat(64) }],
  ])("rejects restoration with %s", (_label, overrides) => {
    const events: OutcomeEvent[] = [];
    const screening = append(events, "SCREENING");
    append(events, "INTERVIEW");
    restore(events, screening, overrides);
    append(events, "OFFER");
    expectInvalid(events);
  });

  it("rejects a target hash made from reordered rather than decoded JSON", () => {
    const events: OutcomeEvent[] = [];
    const interview = append(events, "INTERVIEW");
    const reordered = Object.fromEntries(Object.entries(interview).reverse());
    expect(digest(reordered)).not.toBe(digest(interview));
    restore(events, interview, { evidenceSha256: digest(reordered) });
    expectInvalid(events);
  });

  it("validates abandoned and post-horizon history instead of filtering corruption away", () => {
    const events: OutcomeEvent[] = [];
    const screening = append(events, "SCREENING");
    const abandoned = append(events, "INTERVIEW");
    restore(events, screening);
    abandoned.actor = "mail-correlator";
    expectInvalid(events);
    abandoned.actor = "owner";
    append(events, "OFFER", {
      occurredAt: at(21),
      recordedAt: at(21),
      applicationId: "another-synthetic-application",
    });
    expectInvalid(events);
  });

  it("accepts exactly 1000 events and refuses 1001", () => {
    const events: OutcomeEvent[] = [];
    for (let index = 0; index < 1000; index++)
      append(events, "RECEIVED", { occurredAt: createdAt, recordedAt: createdAt });
    expect(capture(events).milestones).toEqual([]);
    append(events, "RECEIVED", { occurredAt: createdAt, recordedAt: createdAt });
    expectInvalid(events);
  });
});
