import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FixedCohort } from "../../packages/contracts/src/cohort.js";
import {
  compareFixedCohorts,
  fixedCohortReport,
} from "../../packages/matching/src/cohort-report.js";

const fixture = (): FixedCohort => ({
  id: randomUUID(),
  methodology: "fixed_current_outcome_at_observation_horizon_v1",
  window: {
    from: "2026-08-01T00:00:00.000Z",
    through: "2026-08-31T00:00:00.000Z",
    asOf: "2026-10-01T00:00:00.000Z",
    observationDays: 30,
    minimumSample: 20,
  },
  recordedAt: "2026-10-01T00:00:00.000Z",
  exclusions: { synthetic: 4, stillObserving: 2 },
  members: Array.from({ length: 40 }, (_, index) => ({
    applicationId: randomUUID(),
    jobId: randomUUID(),
    receiptId: randomUUID(),
    receiptSha256: "a".repeat(64),
    receivedAt: "2026-08-01T00:00:00.000Z",
    horizon: "2026-08-31T00:00:00.000Z",
    outcome: index < 20 ? "INTERVIEW" : "UNKNOWN",
    outcomeEventId: index < 20 ? randomUUID() : null,
    outcomeEvidenceSha256: index < 20 ? "b".repeat(64) : null,
    metadataSha256: "c".repeat(64),
    groups: {
      source: index < 20 ? "source-a" : "source-b",
      roleFamily: "engineering",
      seniority: "unknown",
      sponsorship: "unknown",
      documentTemplate: "unknown",
    },
  })),
});
describe("fixed horizon cohort reporting", () => {
  it("states denominators, windows and exclusions without inventing probabilities", () => {
    const snapshot = fixture(),
      report = fixedCohortReport(snapshot);
    expect(report.fractions?.INTERVIEW).toEqual({ numerator: 20, denominator: 40, fraction: 0.5 });
    expect(
      report.groups.find((group) => group.dimension === "source" && group.value === "source-a")
        ?.fractions?.INTERVIEW,
    ).toEqual({ numerator: 20, denominator: 20, fraction: 1 });
    expect(report.window).toEqual(snapshot.window);
    expect(report.exclusions).toEqual(snapshot.exclusions);
    expect(JSON.stringify(Object.keys(report))).not.toMatch(/probability|chance|conversionRate/);
    const small = fixedCohortReport({ ...snapshot, members: snapshot.members.slice(0, 19) });
    expect(small).toMatchObject({ status: "insufficient_data", fractions: null });
    expect(small.groups.every((group) => group.fractions === null)).toBe(true);
  });
  it("compares only compatible disjoint groups and preserves sample refusals", () => {
    const left = fixture(),
      right = { ...left, id: randomUUID() };
    expect(compareFixedCohorts(left, right, "source", "source-a", "source-b")).toMatchObject({
      status: "measured",
      differences: { INTERVIEW: 1, UNKNOWN: -1 },
    });
    for (const window of [
      { ...right.window, asOf: "2026-10-02T00:00:00.000Z" },
      { ...right.window, observationDays: 31 },
      { ...right.window, minimumSample: 21 },
    ])
      expect(() =>
        compareFixedCohorts(left, { ...right, window }, "source", "source-a", "source-b"),
      ).toThrow();
    const overlap = {
      ...right,
      members: right.members.map((member, index) =>
        index === 20 ? { ...member, jobId: left.members[0]?.jobId as string } : member,
      ),
    };
    expect(() => compareFixedCohorts(left, overlap, "source", "source-a", "source-b")).toThrow(
      /Overlapping jobs/,
    );
    const small = { ...right, members: right.members.slice(0, 39) };
    expect(compareFixedCohorts(left, small, "source", "source-a", "source-b")).toMatchObject({
      status: "insufficient_data",
      differences: null,
    });
  });
});
