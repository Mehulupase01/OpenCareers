import {
  type CohortDimension,
  cumulativeMilestoneSchema,
  type FixedCohort,
  fixedCohortSchema,
} from "../../contracts/src/cohort.js";
import { DomainError } from "../../contracts/src/index.js";
import { outcomeKindSchema } from "../../contracts/src/outcome.js";

function vacancySignalOrigins(members: FixedCohort["members"]) {
  const intentClassified = members.filter((member) => member.vacancySignalsMethod).length;
  return { intentClassified, legacyUnavailable: members.length - intentClassified };
}

function cumulativeSummary(
  members: FixedCohort["members"],
  minimumSample: number,
  methodology?: FixedCohort["cumulativeMethodology"],
) {
  const denominator = members.length;
  const counts = methodology
    ? Object.fromEntries(
        cumulativeMilestoneSchema.options.map((kind) => [
          kind,
          members.filter((member) =>
            member.cumulativeEvidence?.milestones.some((item) => item.kind === kind),
          ).length,
        ]),
      )
    : null;
  return {
    methodology: methodology ?? null,
    status: !methodology
      ? ("unavailable" as const)
      : denominator >= minimumSample
        ? ("measured" as const)
        : ("insufficient_data" as const),
    denominator,
    counts,
    fractions:
      counts && denominator >= minimumSample
        ? Object.fromEntries(
            Object.entries(counts).map(([kind, numerator]) => [
              kind,
              { numerator, denominator, fraction: numerator / denominator },
            ]),
          )
        : null,
    withoutMilestoneEvidence: methodology
      ? members.filter((member) => !member.cumulativeEvidence?.milestones.length).length
      : null,
  };
}
function summarize(
  members: FixedCohort["members"],
  minimumSample: number,
  cumulativeMethodology?: FixedCohort["cumulativeMethodology"],
) {
  const counts = Object.fromEntries(outcomeKindSchema.options.map((kind) => [kind, 0]));
  for (const member of members) counts[member.outcome] = (counts[member.outcome] ?? 0) + 1;
  const denominator = members.length;
  return {
    status: denominator >= minimumSample ? ("measured" as const) : ("insufficient_data" as const),
    denominator,
    counts,
    cumulative: cumulativeSummary(members, minimumSample, cumulativeMethodology),
    fractions:
      denominator >= minimumSample
        ? Object.fromEntries(
            Object.entries(counts).map(([kind, numerator]) => [
              kind,
              { numerator, denominator, fraction: numerator / denominator },
            ]),
          )
        : null,
  };
}
export function fixedCohortReport(raw: FixedCohort) {
  const snapshot = fixedCohortSchema.parse(raw);
  const groups = cohortDimensions.flatMap((dimension) => {
    const grouped = new Map<string, FixedCohort["members"]>();
    for (const member of snapshot.members) {
      const value = member.groups[dimension] ?? "unassigned";
      const entries = grouped.get(value) ?? [];
      entries.push(member);
      grouped.set(value, entries);
    }
    return [...grouped]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, members]) => ({
        dimension,
        value,
        vacancySignalOrigins: vacancySignalOrigins(members),
        ...summarize(members, snapshot.window.minimumSample, snapshot.cumulativeMethodology),
      }));
  });
  return {
    snapshotId: snapshot.id,
    methodology: snapshot.methodology,
    advisoryOnly: true as const,
    window: snapshot.window,
    recordedAt: snapshot.recordedAt,
    exclusions: snapshot.exclusions,
    metadataOrigins: {
      submissionIntent: snapshot.members.filter(
        (member) => member.metadataOrigin === "submission_intent",
      ).length,
      legacySnapshot: snapshot.members.filter((member) => !member.metadataOrigin).length,
    },
    vacancySignalOrigins: vacancySignalOrigins(snapshot.members),
    ...summarize(snapshot.members, snapshot.window.minimumSample, snapshot.cumulativeMethodology),
    groups,
    limits: [
      "Current status and cumulative observed milestones use separate numerators at the fixed horizon; no missing funnel stage is inferred.",
      "Legacy cumulative evidence is unavailable, not zero. UNKNOWN resets milestone evidence; restorations rebase the recorded history.",
      "New source/role groups use intent-time metadata; legacy groups retain snapshot-time metadata and are not backfilled.",
      "Seniority and sponsorship are explicit vacancy signals frozen at intent time, not guarantees. Legacy classification is unavailable; silence or ambiguity remains unknown.",
      "Unknown metadata is not inferred. Comparisons are descriptive, not causal or hiring probabilities.",
      "Experiment groups require pre-dispatch assignment evidence; legacy records stay unassigned.",
    ],
  };
}
const cohortDimensions: CohortDimension[] = [
  "source",
  "roleFamily",
  "seniority",
  "sponsorship",
  "documentTemplate",
  "experimentVariant",
];

export function compareFixedCohorts(
  leftRaw: FixedCohort,
  rightRaw: FixedCohort,
  dimension: CohortDimension,
  leftValue: string,
  rightValue: string,
) {
  const left = fixedCohortSchema.parse(leftRaw),
    right = fixedCohortSchema.parse(rightRaw);
  if (
    left.methodology !== right.methodology ||
    JSON.stringify(left.window) !== JSON.stringify(right.window)
  )
    throw new DomainError("STATE_INVALID", "Cohort windows or methodology are incompatible.");
  if (leftValue === rightValue)
    throw new DomainError("STATE_INVALID", "Distinct comparison groups are required.");
  const a = left.members.filter(
    (member) => (member.groups[dimension] ?? "unassigned") === leftValue,
  );
  const b = right.members.filter(
    (member) => (member.groups[dimension] ?? "unassigned") === rightValue,
  );
  if (!a.length || !b.length) throw new DomainError("NOT_FOUND", "Comparison group not found.");
  if (
    ["source", "roleFamily"].includes(dimension) &&
    new Set([...a, ...b].map((member) => member.metadataOrigin ?? "legacy_snapshot")).size > 1
  )
    throw new DomainError(
      "STATE_INVALID",
      "Source/role comparisons require consistent metadata provenance.",
    );
  if (
    ["seniority", "sponsorship"].includes(dimension) &&
    [...a, ...b].some((member) => member.vacancySignalsMethod !== "explicit_vacancy_signals_v1")
  )
    throw new DomainError(
      "STATE_INVALID",
      "Vacancy-signal comparisons require consistent intent-time classification provenance.",
    );
  if (dimension === "experimentVariant") {
    const reference = a[0]?.experiment;
    if (
      !reference ||
      [...a, ...b].some(
        (member) =>
          !member.experiment ||
          member.experiment.id !== reference.id ||
          member.experiment.definitionSha256 !== reference.definitionSha256 ||
          member.experiment.metric !== reference.metric ||
          member.experiment.observationDays !== left.window.observationDays ||
          member.groups.experimentVariant !==
            `${member.experiment.id}/${member.experiment.variantId}`,
      )
    )
      throw new DomainError(
        "STATE_INVALID",
        "Experiment comparisons require one definition and its declared observation horizon.",
      );
  }
  const jobs = new Set(a.map((member) => member.jobId));
  if (b.some((member) => jobs.has(member.jobId)))
    throw new DomainError(
      "STATE_INVALID",
      "Overlapping jobs cannot be compared as independent groups.",
    );
  const leftReport = summarize(a, left.window.minimumSample, left.cumulativeMethodology),
    rightReport = summarize(b, right.window.minimumSample, right.cumulativeMethodology);
  return {
    status:
      leftReport.fractions && rightReport.fractions
        ? ("measured" as const)
        : ("insufficient_data" as const),
    advisoryOnly: true as const,
    methodology: left.methodology,
    window: left.window,
    dimension,
    declaredMetric: dimension === "experimentVariant" ? (a[0]?.experiment?.metric ?? null) : null,
    left: { snapshotId: left.id, value: leftValue, ...leftReport, exclusions: left.exclusions },
    right: {
      snapshotId: right.id,
      value: rightValue,
      ...rightReport,
      exclusions: right.exclusions,
    },
    differences:
      leftReport.fractions && rightReport.fractions
        ? Object.fromEntries(
            outcomeKindSchema.options.map((kind) => [
              kind,
              (leftReport.fractions?.[kind]?.fraction ?? 0) -
                (rightReport.fractions?.[kind]?.fraction ?? 0),
            ]),
          )
        : null,
    cumulative: {
      status:
        !left.cumulativeMethodology || !right.cumulativeMethodology
          ? ("unavailable" as const)
          : leftReport.cumulative.fractions && rightReport.cumulative.fractions
            ? ("measured" as const)
            : ("insufficient_data" as const),
      left: leftReport.cumulative,
      right: rightReport.cumulative,
      differences:
        leftReport.cumulative.fractions && rightReport.cumulative.fractions
          ? Object.fromEntries(
              cumulativeMilestoneSchema.options.map((kind) => [
                kind,
                (leftReport.cumulative.fractions?.[kind]?.fraction ?? 0) -
                  (rightReport.cumulative.fractions?.[kind]?.fraction ?? 0),
              ]),
            )
          : null,
    },
    limits: [
      "Descriptive outcome-fraction differences, not causal effects or significance estimates.",
      "No automatic policy, score or submission changes.",
    ],
  };
}
