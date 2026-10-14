import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type FixedCohort, fixedCohortSchema } from "../../packages/contracts/src/cohort.js";
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
  it("preserves legacy snapshot bytes and labels unavailable vacancy classification", () => {
    const snapshot = fixture();
    const original = JSON.stringify(snapshot);
    expect(JSON.stringify(fixedCohortSchema.parse(snapshot))).toBe(original);
    const report = fixedCohortReport(snapshot);
    expect(report.vacancySignalOrigins).toEqual({ intentClassified: 0, legacyUnavailable: 40 });
    expect(report.groups.find((group) => group.dimension === "sponsorship")).toMatchObject({
      value: "unknown",
      denominator: 40,
      vacancySignalOrigins: { intentClassified: 0, legacyUnavailable: 40 },
    });
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it.each(["seniority", "sponsorship"] as const)(
    "compares %s only with compatible frozen signals and retains unknown denominators",
    (dimension) => {
      const snapshot = fixture();
      snapshot.members = snapshot.members.map((member, index) => ({
        ...member,
        metadataOrigin: "submission_intent",
        vacancySignalsMethod: "explicit_vacancy_signals_v1",
        groups: {
          ...member.groups,
          seniority: index < 20 ? "senior" : "unknown",
          sponsorship: index < 20 ? "explicitly_available" : "unknown",
        },
      }));
      const value = dimension === "seniority" ? "senior" : "explicitly_available";
      const report = fixedCohortReport(snapshot);
      expect(report.denominator).toBe(40);
      expect(report.vacancySignalOrigins).toEqual({ intentClassified: 40, legacyUnavailable: 0 });
      expect(
        report.groups.find((group) => group.dimension === dimension && group.value === "unknown"),
      ).toMatchObject({
        denominator: 20,
        vacancySignalOrigins: { intentClassified: 20, legacyUnavailable: 0 },
      });
      expect(compareFixedCohorts(snapshot, snapshot, dimension, value, "unknown")).toMatchObject({
        status: "measured",
        advisoryOnly: true,
        left: { denominator: 20 },
        right: { denominator: 20 },
        differences: { INTERVIEW: 1 },
      });
      const mixed: FixedCohort = {
        ...snapshot,
        members: snapshot.members.map((member, index) =>
          index < 20
            ? member
            : {
                ...member,
                vacancySignalsMethod: undefined,
              },
        ),
      };
      expect(fixedCohortReport(mixed).vacancySignalOrigins).toEqual({
        intentClassified: 20,
        legacyUnavailable: 20,
      });
      expect(() => compareFixedCohorts(mixed, mixed, dimension, value, "unknown")).toThrow(
        "consistent intent-time classification provenance",
      );
      const small = { ...snapshot, members: snapshot.members.slice(1) };
      expect(compareFixedCohorts(small, small, dimension, value, "unknown")).toMatchObject({
        status: "insufficient_data",
        differences: null,
      });
    },
  );
  it("reports separate cumulative milestones without interpreting legacy current status as history", () => {
    const legacy = fixture();
    expect(fixedCohortReport(legacy).cumulative).toMatchObject({
      status: "unavailable",
      denominator: 40,
      counts: null,
      fractions: null,
    });
    const snapshot: FixedCohort = {
      ...legacy,
      cumulativeMethodology: "corrected_observed_milestones_v1",
      members: legacy.members.map((member, index) => ({
        ...member,
        outcome: "REJECTION",
        cumulativeEvidence: {
          historySha256: "d".repeat(64),
          milestones:
            index < 20
              ? [
                  {
                    kind: "INTERVIEW",
                    eventId: member.outcomeEventId as string,
                    revision: 1,
                    evidenceSha256: "b".repeat(64),
                    occurredAt: member.receivedAt,
                  },
                ]
              : [],
        },
      })),
    };
    const report = fixedCohortReport(snapshot);
    expect(report.counts.INTERVIEW).toBe(0);
    expect(report.cumulative).toMatchObject({
      status: "measured",
      counts: { SCREENING: 0, INTERVIEW: 20, OFFER: 0 },
      withoutMilestoneEvidence: 20,
      fractions: { INTERVIEW: { numerator: 20, denominator: 40, fraction: 0.5 } },
    });
    const compared = compareFixedCohorts(snapshot, snapshot, "source", "source-a", "source-b");
    expect(compared.cumulative).toMatchObject({
      status: "measured",
      differences: { INTERVIEW: 1, SCREENING: 0, OFFER: 0 },
    });
    const mixed = compareFixedCohorts(legacy, snapshot, "source", "source-a", "source-b");
    expect(mixed.cumulative).toMatchObject({ status: "unavailable", differences: null });
    const small = fixedCohortReport({ ...snapshot, members: snapshot.members.slice(0, 19) });
    expect(small.cumulative).toMatchObject({
      status: "insufficient_data",
      counts: { INTERVIEW: 19 },
      fractions: null,
    });
    expect(() =>
      fixedCohortReport({
        ...snapshot,
        members: snapshot.members.map((member, index) =>
          index === 0 ? { ...member, cumulativeEvidence: undefined } : member,
        ),
      }),
    ).toThrow();
    expect(() => fixedCohortReport({ ...snapshot, cumulativeMethodology: undefined })).toThrow();
    const member = snapshot.members[0];
    const evidence = member?.cumulativeEvidence;
    const milestone = evidence?.milestones[0];
    if (!member || !evidence || !milestone) throw new Error("Synthetic milestone missing.");
    expect(() =>
      fixedCohortReport({
        ...snapshot,
        members: [
          {
            ...member,
            cumulativeEvidence: {
              ...evidence,
              milestones: [milestone, milestone],
            },
          },
        ],
      }),
    ).toThrow();
  });
  it("distinguishes intent-time metadata and refuses mixing it with legacy source attribution", () => {
    const snapshot = fixture();
    snapshot.members = snapshot.members.map((member, index) =>
      index < 20 ? { ...member, metadataOrigin: "submission_intent" } : member,
    );
    expect(fixedCohortReport(snapshot)).toMatchObject({
      metadataOrigins: { submissionIntent: 20, legacySnapshot: 20 },
    });
    expect(() => compareFixedCohorts(snapshot, snapshot, "source", "source-a", "source-b")).toThrow(
      "consistent metadata provenance",
    );
    snapshot.members = snapshot.members.map((member) => ({
      ...member,
      metadataOrigin: "submission_intent",
    }));
    expect(compareFixedCohorts(snapshot, snapshot, "source", "source-a", "source-b")).toMatchObject(
      { status: "measured" },
    );
  });
  it("compares only variants of one frozen definition at its declared horizon", () => {
    const snapshot = fixture(),
      id = randomUUID();
    snapshot.members = snapshot.members.map((member, index) => {
      const variantId = index < 20 ? "baseline" : "concise";
      return {
        ...member,
        groups: { ...member.groups, experimentVariant: `${id}/${variantId}` },
        experiment: {
          id,
          variantId,
          metric: "INTERVIEW",
          observationDays: 30,
          definitionSha256: "d".repeat(64),
          assignmentSha256: "e".repeat(64),
          approvalSha256: "f".repeat(64),
          packetSha256: "a".repeat(64),
        },
      };
    });
    expect(
      compareFixedCohorts(
        snapshot,
        snapshot,
        "experimentVariant",
        `${id}/baseline`,
        `${id}/concise`,
      ),
    ).toMatchObject({
      status: "measured",
      declaredMetric: "INTERVIEW",
      differences: { INTERVIEW: 1, UNKNOWN: -1 },
    });
    for (const override of [
      { id: randomUUID() },
      { definitionSha256: "a".repeat(64) },
      { metric: "OFFER" as const },
      { observationDays: 31 },
    ]) {
      const changed = {
        ...snapshot,
        members: snapshot.members.map((member, index) =>
          index === 20 && member.experiment
            ? { ...member, experiment: { ...member.experiment, ...override } }
            : member,
        ),
      };
      expect(() =>
        compareFixedCohorts(
          snapshot,
          changed,
          "experimentVariant",
          `${id}/baseline`,
          `${id}/concise`,
        ),
      ).toThrow(/one definition/);
    }
    const legacy = fixture();
    expect(
      fixedCohortReport(legacy).groups.find((group) => group.dimension === "experimentVariant"),
    ).toMatchObject({ value: "unassigned", denominator: 40 });
    expect(() =>
      compareFixedCohorts(legacy, snapshot, "experimentVariant", "unassigned", `${id}/concise`),
    ).toThrow();
    expect(
      compareFixedCohorts(
        { ...snapshot, members: snapshot.members.slice(0, 39) },
        snapshot,
        "experimentVariant",
        `${id}/baseline`,
        `${id}/concise`,
      ),
    ).toMatchObject({ status: "measured" });
    expect(
      compareFixedCohorts(
        snapshot,
        { ...snapshot, members: snapshot.members.slice(0, 39) },
        "experimentVariant",
        `${id}/baseline`,
        `${id}/concise`,
      ),
    ).toMatchObject({ status: "insufficient_data", differences: null });
  });
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
