import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type FixedCohort,
  fixedCohortSchema,
  submissionCohortMetadataSchema,
  vacancySignalsSchema,
} from "../../packages/contracts/src/cohort.js";
import { classifyVacancySignals } from "../../packages/matching/src/vacancy-signals.js";

const method = "explicit_vacancy_signals_v1" as const;
const unknown = { method, seniority: "unknown", sponsorship: "unknown", evidence: [] };
const classify = (title = "Engineer", description = "") =>
  classifyVacancySignals({ title, description });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("explicit vacancy signals", () => {
  it.each([
    ["Intern Software Engineer", "intern", "Intern"],
    ["Software Engineering Intern", "intern", "Intern"],
    ["Internship", "intern", "Internship"],
    ["Junior Engineer", "junior", "Junior"],
    ["Jr Engineer", "junior", "Jr"],
    ["Mid-level Engineer", "mid", "Mid-level"],
    ["Mid Level Engineer", "mid", "Mid Level"],
    ["Senior Engineer", "senior", "Senior"],
    ["Sr Engineer", "senior", "Sr"],
    ["Lead Engineer", "lead", "Lead"],
    ["Engineering Lead", "lead", "Lead"],
  ])("classifies the explicit title %s", (title, seniority, text) => {
    const result = classify(title, "Requires 10 years of experience.");
    const start = title.indexOf(text);
    expect(result).toEqual({
      method,
      seniority,
      sponsorship: "unknown",
      evidence: [{ dimension: "seniority", field: "title", start, end: start + text.length, text }],
    });
    expect(vacancySignalsSchema.parse(result)).toEqual(result);
  });

  it.each([
    "Engineer",
    "Senior / Junior Engineer",
    "Junior or Senior Engineer",
    "Mid-to-Senior Engineer",
    "Senior Lead Engineer",
    "Senior Senior Engineer",
    "Not a Senior Engineer",
    "Non-Senior Engineer",
    "Senior Engineer (not junior)",
    "Assistant to Senior Engineer",
    "Recruiter for Senior Engineers",
    "Lead Generation Specialist",
    "Principal Engineer",
    "Staff Engineer",
    "Entry-level Engineer",
    "Mid-career Engineer",
    "Engineer II",
    "Senior's Assistant",
    "Senior or equivalent Engineer",
    "Senior Engineer isn't the role",
    "Senior Engineer (optional)",
    "Senior Engineer example",
    'Senior Engineer "example"',
    "Senior Engineer - hypothetical",
    "Senior Citizen Advisor",
    "Junior School Teacher",
    "Senior Care Worker",
    "  Lead Generation Specialist",
    "Lead Poisoning Researcher",
    "Senior Engineer if approved",
    "Senior Engineer (may be available)",
  ])("does not infer a level from %s", (title) => {
    expect(classify(title, "Senior engineer required. 10 years of experience.")).toEqual(unknown);
  });

  it.each([
    "We offer visa sponsorship.",
    "We provide work visa sponsorship for this role.",
    "We will provide visa sponsorship.",
    "Visa sponsorship is available.",
    "Visa sponsorship available",
    "We sponsor visas.",
  ])("accepts only explicit offers: %s", (description) => {
    const result = classify("Engineer", description);
    expect(result.sponsorship).toBe("explicitly_available");
    expect(result.evidence).toHaveLength(1);
  });

  it.each([
    "We do not offer visa sponsorship.",
    "We cannot provide visa sponsorship for this position.",
    "Visa sponsorship is not available.",
    "Visa sponsorship unavailable",
    "No visa sponsorship.",
    "We will not sponsor work visas.",
  ])("accepts only explicit refusals: %s", (description) => {
    expect(classify("Engineer", description).sponsorship).toBe("explicitly_unavailable");
  });

  it.each([
    "",
    "Must be authorized to work in Germany.",
    "Applicants must have the right to work without sponsorship.",
    "Do you require visa sponsorship now or in the future?",
    "Candidates requiring sponsorship are not eligible.",
    "We cannot accept candidates requiring sponsorship.",
    "Visa sponsorship may be available.",
    "We offer visa sponsorship if approved.",
    "If approved. We offer visa sponsorship.",
    "We offer visa sponsorship. Conditions apply.",
    "Visa sponsorship is subject to approval.",
    "We offer visa sponsorship for eligible candidates.",
    "We offer visa sponsorship. Applicants must already hold a work permit.",
    "We do not guarantee visa sponsorship.",
    "We do not refuse visa sponsorship.",
    "We are not unable to offer visa sponsorship.",
    "We offer visa sponsorship. Not true.",
    "Visa sponsorship is not unavailable.",
    "Visa sponsorship is available?",
    "We offer visa sponsorship. We do not sponsor visas.",
    "Visa sponsorship is available. Sponsorship is unavailable.",
    "Sponsorship experience required.",
    "Visa sponsorship: negotiable.",
    "Visumsponsoring ist verfuegbar.",
    "We offer visa sponsorship, aber nur nach Genehmigung.",
    'The candidate said "We offer visa sponsorship."',
    "Our company sponsors nothing. We sponsor visas.",
    "Example vacancy:\nWe offer visa sponsorship.",
    "Example wording:\nWe offer visa sponsorship.",
    "Other employers say:\nWe offer visa sponsorship.",
    "Previous policy:\nWe offer visa sponsorship.",
    "Historical statement:\nWe offer visa sponsorship.",
    "Our competitors advertise:\nWe offer visa sponsorship.",
    "Last year:\nWe offer visa sponsorship.",
    "Template wording:\nWe offer visa sponsorship.",
    "We offer visa sponsorship. This statement is incorrect.",
    "We offer visa sponsorship. Pending approval.",
    "We offer visa sponsorship. For some roles.",
    "We offer visa sponsorship. This doesn't apply.",
    "'We offer visa sponsorship.'",
    "\u201cWe offer visa sponsorship.\u201d",
  ])("leaves unsupported, qualified or conflicting wording unknown: %s", (description) => {
    expect(classify("Engineer", description)).toEqual(unknown);
  });

  it("checks sponsorship in both fields and rejects cross-field contradictions", () => {
    expect(classify("Visa sponsorship available").sponsorship).toBe("explicitly_available");
    expect(classify("Visa sponsorship available", "No visa sponsorship.")).toEqual(unknown);
  });

  it("records exact original UTF-16 spans without normalizing source text", () => {
    const job = {
      title: "  SENIOR Engineer",
      description:
        "\ud83d\ude80 Build tools.\n  We offer visa sponsorship.\nVisa sponsorship is available.",
    };
    const result = classifyVacancySignals(job);
    expect(result.seniority).toBe("senior");
    expect(result.sponsorship).toBe("explicitly_available");
    expect(result.evidence).toHaveLength(3);
    for (const span of result.evidence) {
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.end).toBeLessThanOrEqual(job[span.field].length);
      expect(job[span.field].slice(span.start, span.end)).toBe(span.text);
      expect(span.text.length).toBe(span.end - span.start);
      expect(span.text.length).toBeLessThanOrEqual(300);
    }
    expect(vacancySignalsSchema.safeParse(result).success).toBe(true);
    expect(classifyVacancySignals(job)).toEqual(result);
  });

  it("bounds malicious inputs and does not classify a prefix hiding contradictions", () => {
    for (const job of [
      { title: `Senior Engineer${" ".repeat(241)}`, description: "We offer visa sponsorship." },
      { title: "Senior Engineer", description: `${"x".repeat(100001)}No visa sponsorship.` },
      { title: "Senior Engineer", description: "We offer visa sponsorship.".repeat(10000) },
    ])
      expect(classifyVacancySignals(job)).toEqual(unknown);
    const crowded = classify("Senior Engineer", "We offer visa sponsorship. ".repeat(7));
    expect(crowded.evidence).toHaveLength(8);
    const overflow = classify("Senior Engineer", "We offer visa sponsorship. ".repeat(8));
    expect(overflow.seniority).toBe("senior");
    expect(overflow.sponsorship).toBe("unknown");
    expect(overflow.evidence).toHaveLength(1);
    expect(classify("Engineer", `${"(".repeat(99000)}visa sponsorship`)).toEqual(unknown);
  });
});

const snapshot = (): FixedCohort => ({
  id: "00000000-0000-4000-8000-000000000001",
  methodology: "fixed_current_outcome_at_observation_horizon_v1",
  window: {
    from: "2026-08-01T00:00:00.000Z",
    through: "2026-08-31T00:00:00.000Z",
    asOf: "2026-10-01T00:00:00.000Z",
    observationDays: 30,
    minimumSample: 20,
  },
  recordedAt: "2026-10-01T00:00:00.000Z",
  exclusions: {},
  members: [
    {
      applicationId: "application",
      jobId: "job",
      receiptId: "receipt",
      receiptSha256: "a".repeat(64),
      receivedAt: "2026-08-01T00:00:00.000Z",
      horizon: "2026-08-31T00:00:00.000Z",
      outcome: "UNKNOWN",
      outcomeEventId: null,
      outcomeEvidenceSha256: null,
      metadataSha256: "b".repeat(64),
      groups: {
        source: "source",
        roleFamily: "engineering",
        seniority: "unknown",
        sponsorship: "unknown",
        documentTemplate: "unknown",
      },
    },
  ],
});

describe("vacancy contracts and legacy bytes", () => {
  it("preserves literal v1 JSON, field order and digest without adding defaults", () => {
    const bytes =
      '{"method":"frozen_job_at_intent_v1","jobId":"job","jobSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source":"source","roleFamily":"engineering","synthetic":false}';
    const legacy = JSON.parse(bytes);
    const parsed = submissionCohortMetadataSchema.parse(legacy);
    expect(JSON.stringify(parsed)).toBe(bytes);
    expect(hash(JSON.stringify(parsed))).toBe(hash(bytes));
    const { method: legacyMethod, ...rest } = legacy;
    expect(submissionCohortMetadataSchema.parse({ ...rest, method: legacyMethod })).toEqual(parsed);
    expect(
      JSON.stringify(submissionCohortMetadataSchema.parse({ ...rest, method: legacyMethod })),
    ).toBe(bytes);
    expect(
      submissionCohortMetadataSchema.safeParse({ ...legacy, vacancySignals: unknown }).success,
    ).toBe(false);
    const v2 = { ...legacy, method: "frozen_job_at_intent_v2", vacancySignals: unknown };
    expect(Object.keys(submissionCohortMetadataSchema.parse(v2))).toEqual([
      "method",
      "jobId",
      "jobSha256",
      "source",
      "roleFamily",
      "synthetic",
      "vacancySignals",
    ]);
    expect(
      submissionCohortMetadataSchema.safeParse({ ...rest, method: "frozen_job_at_intent_v2" })
        .success,
    ).toBe(false);
    expect(submissionCohortMetadataSchema.safeParse({ ...v2, extra: true }).success).toBe(false);
    expect(submissionCohortMetadataSchema.safeParse({ ...v2, method: "future" }).success).toBe(
      false,
    );
  });

  it("strictly validates categories, method, evidence bounds and exact span length", () => {
    const span = { dimension: "seniority", field: "title", start: 0, end: 6, text: "Senior" };
    expect(vacancySignalsSchema.safeParse({ ...unknown, evidence: [span] }).success).toBe(true);
    for (const bad of [
      { ...unknown, method: "future" },
      { ...unknown, seniority: "principal" },
      { ...unknown, sponsorship: "available" },
      { ...unknown, extra: true },
      { ...unknown, evidence: Array(9).fill(span) },
      ...[
        { start: -1 },
        { start: 0.5 },
        { end: 0 },
        { start: 6 },
        { start: 7 },
        { end: 6.5 },
        { text: "" },
        { text: "short" },
        { end: 301, text: "x".repeat(301) },
        { dimension: "experience" },
        { field: "company" },
        { extra: true },
      ].map((change) => ({ ...unknown, evidence: [{ ...span, ...change }] })),
    ])
      expect(vacancySignalsSchema.safeParse(bad).success).toBe(false);
    for (const key of ["method", "seniority", "sponsorship", "evidence"]) {
      const missing: Record<string, unknown> = { ...unknown };
      delete missing[key];
      expect(vacancySignalsSchema.safeParse(missing).success).toBe(false);
    }
  });

  it("requires dimension-specific evidence for nonunknown signals and rejects duplicate spans", () => {
    const title = { dimension: "seniority", field: "title", start: 0, end: 6, text: "Senior" };
    const sponsorship = {
      dimension: "sponsorship",
      field: "description",
      start: 0,
      end: 27,
      text: "Visa sponsorship available",
    };
    sponsorship.end = sponsorship.text.length;
    for (const seniority of ["intern", "junior", "mid", "senior", "lead"]) {
      expect(vacancySignalsSchema.safeParse({ ...unknown, seniority }).success).toBe(false);
      expect(
        vacancySignalsSchema.safeParse({ ...unknown, seniority, evidence: [sponsorship] }).success,
      ).toBe(false);
      expect(
        vacancySignalsSchema.safeParse({
          ...unknown,
          seniority,
          evidence: [{ ...title, field: "description" }],
        }).success,
      ).toBe(false);
      expect(
        vacancySignalsSchema.safeParse({ ...unknown, seniority, evidence: [title] }).success,
      ).toBe(true);
    }
    for (const value of ["explicitly_available", "explicitly_unavailable"]) {
      expect(vacancySignalsSchema.safeParse({ ...unknown, sponsorship: value }).success).toBe(
        false,
      );
      expect(
        vacancySignalsSchema.safeParse({ ...unknown, sponsorship: value, evidence: [title] })
          .success,
      ).toBe(false);
      for (const field of ["title", "description"])
        expect(
          vacancySignalsSchema.safeParse({
            ...unknown,
            sponsorship: value,
            evidence: [{ ...sponsorship, field }],
          }).success,
        ).toBe(true);
    }
    expect(vacancySignalsSchema.safeParse({ ...unknown, evidence: [title, title] }).success).toBe(
      false,
    );
    expect(
      vacancySignalsSchema.safeParse({
        ...unknown,
        evidence: [title, { ...title, dimension: "sponsorship" }],
      }).success,
    ).toBe(true);
    for (const [field, limit] of [
      ["title", 240],
      ["description", 100000],
    ] as const) {
      const atLimit = { ...title, field, start: limit - 6, end: limit };
      expect(vacancySignalsSchema.safeParse({ ...unknown, evidence: [atLimit] }).success).toBe(
        true,
      );
      expect(
        vacancySignalsSchema.safeParse({
          ...unknown,
          evidence: [{ ...atLimit, start: atLimit.start + 1, end: limit + 1 }],
        }).success,
      ).toBe(false);
    }
    const v2 = {
      method: "frozen_job_at_intent_v2",
      jobId: "job",
      jobSha256: "a".repeat(64),
      source: "source",
      roleFamily: "engineering",
      synthetic: false,
    };
    expect(
      submissionCohortMetadataSchema.safeParse({
        ...v2,
        vacancySignals: { ...unknown, seniority: "senior" },
      }).success,
    ).toBe(false);
    expect(
      submissionCohortMetadataSchema.safeParse({
        ...v2,
        vacancySignals: { ...unknown, sponsorship: "explicitly_available" },
      }).success,
    ).toBe(false);
  });

  it("preserves legacy snapshot bytes and all existing optional fields", () => {
    const legacy = snapshot();
    const bytes = JSON.stringify(legacy);
    expect(JSON.stringify(fixedCohortSchema.parse(legacy))).toBe(bytes);
    expect(hash(JSON.stringify(fixedCohortSchema.parse(legacy)))).toBe(hash(bytes));
    const member = legacy.members[0];
    if (!member) throw new Error("Missing fixture member.");
    member.metadataOrigin = "submission_intent";
    member.groups.experimentVariant = "variant-a";
    legacy.cumulativeMethodology = "corrected_observed_milestones_v1";
    member.cumulativeEvidence = { historySha256: "c".repeat(64), milestones: [] };
    member.experiment = {
      id: legacy.id,
      variantId: "variant-a",
      metric: "INTERVIEW",
      observationDays: 30,
      definitionSha256: "d".repeat(64),
      assignmentSha256: "e".repeat(64),
      approvalSha256: "f".repeat(64),
      packetSha256: "a".repeat(64),
    };
    expect(fixedCohortSchema.parse(legacy)).toEqual(legacy);
  });

  it("requires method and intent origin for either known dimension, with no defaults", () => {
    for (const change of [
      { seniority: "intern" },
      { seniority: "junior" },
      { seniority: "mid" },
      { seniority: "senior" },
      { seniority: "lead" },
      { sponsorship: "explicitly_available" },
      { sponsorship: "explicitly_unavailable" },
    ] as const) {
      const value = snapshot();
      const member = value.members[0];
      if (!member) throw new Error("Missing fixture member.");
      Object.assign(member.groups, change);
      expect(fixedCohortSchema.safeParse(value).success).toBe(false);
      member.metadataOrigin = "submission_intent";
      expect(fixedCohortSchema.safeParse(value).success).toBe(false);
      member.vacancySignalsMethod = method;
      expect(fixedCohortSchema.safeParse(value).success).toBe(true);
      delete member.metadataOrigin;
      expect(fixedCohortSchema.safeParse(value).success).toBe(false);
    }
    const value = snapshot();
    const member = value.members[0];
    if (!member) throw new Error("Missing fixture member.");
    member.vacancySignalsMethod = method;
    expect(fixedCohortSchema.safeParse(value).success).toBe(false);
    member.metadataOrigin = "submission_intent";
    expect(fixedCohortSchema.safeParse(value).success).toBe(true);
    expect(
      fixedCohortSchema.safeParse({
        ...value,
        members: [{ ...member, vacancySignalsMethod: "future" }],
      }).success,
    ).toBe(false);
    for (const field of ["seniority", "sponsorship"]) {
      const groups = { ...member.groups } as Record<string, unknown>;
      delete groups[field];
      expect(
        fixedCohortSchema.safeParse({ ...value, members: [{ ...member, groups }] }).success,
      ).toBe(false);
    }
  });
});
