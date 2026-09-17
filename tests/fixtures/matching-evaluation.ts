import type { CandidateFact } from "../../packages/contracts/src/candidate.js";
import type { MatchingInput } from "../../packages/contracts/src/matching.js";
import type { EvaluationCase, EvaluationLabel } from "../../packages/matching/src/evaluation.js";

const skill: CandidateFact = {
  id: "evaluation-fact-python",
  key: "skill-python",
  revision: 1,
  status: "verified",
  value: { kind: "skill", name: "Python", firstUsed: "2020-01" },
  provenance: { kind: "owner", statement: "Synthetic reviewed Python evidence." },
  expiresOn: null,
  recordedAt: "2026-09-16T00:00:00.000Z",
  reviewedAt: "2026-09-16T00:00:00.000Z",
};
const language: CandidateFact = {
  ...skill,
  id: "evaluation-fact-english",
  key: "language-english",
  value: { kind: "language", name: "English", level: "C1" },
};
const work: CandidateFact = {
  ...skill,
  id: "evaluation-fact-work-nl",
  key: "work-nl",
  value: {
    kind: "work_authorization",
    country: "NL",
    currentlyAuthorized: "yes",
    permitExpiresOn: "2027-09-16",
    futureSponsorship: "no",
    approvedWording: "Authorized to work in the Netherlands.",
  },
};

const holdout = new Set([
  "strong-04",
  "strong-11",
  "strong-18",
  "location-03",
  "location-08",
  "duplicate-05",
  "language-06",
  "authorization-04",
  "salary-07",
  "role-review-03",
  "authorization-review-04",
  "closed-02",
]);

function base(id: string): MatchingInput {
  return {
    job: {
      id: `evaluation-${id}`,
      employerId: `employer-${id}`,
      requisitionId: `REQ-${id}`,
      title: "Software Engineer",
      company: "Synthetic Evaluation Company",
      location: "Amsterdam, NL",
      countryCode: "NL",
      url: `https://evaluation.example/jobs/${id}`,
      description: "We require Python for reliable services. Salary EUR 80000.",
      source: "Frozen synthetic evaluation",
      synthetic: true,
    },
    facts: [skill, language, work],
    profileId: "evaluation-profile",
    roleTerms: ["Software Engineer"],
    countries: ["NL"],
    salaryMinimum: 60000,
    salaryNegotiable: false,
    listingState: "open",
    duplicate: false,
  };
}

function item(
  id: string,
  expected: EvaluationLabel,
  hardDisqualifier: boolean,
  change: (input: MatchingInput) => MatchingInput = (input) => input,
): EvaluationCase {
  return {
    id,
    split: holdout.has(id) ? "holdout" : "development",
    hardDisqualifier,
    expected,
    input: change(base(id)),
  };
}

const numbered = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`);

export const matchingEvaluationCases: EvaluationCase[] = [
  ...numbered("strong", 20).map((id) => item(id, "auto_eligible", false)),
  ...numbered("location", 8).map((id) =>
    item(id, "ineligible", true, (input) => ({ ...input, countries: ["DE"] })),
  ),
  ...numbered("duplicate", 8).map((id) =>
    item(id, "ineligible", true, (input) => ({ ...input, duplicate: true })),
  ),
  ...numbered("language", 8).map((id) =>
    item(id, "ineligible", true, (input) => ({
      ...input,
      facts: [skill, work],
      job: {
        ...input.job,
        description: `${input.job.description} Fluent Dutch is required.`,
      },
    })),
  ),
  ...numbered("authorization", 8).map((id) =>
    item(id, "ineligible", true, (input) => ({
      ...input,
      facts: input.facts.map((fact) =>
        fact.value.kind === "work_authorization"
          ? { ...fact, value: { ...fact.value, permitExpiresOn: "2025-01-01" } }
          : fact,
      ),
    })),
  ),
  ...numbered("salary", 8).map((id) =>
    item(id, "ineligible", true, (input) => ({
      ...input,
      salaryMinimum: 90000,
    })),
  ),
  ...numbered("role-review", 4).map((id) =>
    item(id, "review", false, (input) => ({
      ...input,
      job: { ...input.job, title: "Technical Product Specialist" },
    })),
  ),
  ...numbered("authorization-review", 4).map((id) =>
    item(id, "review", false, (input) => ({
      ...input,
      facts: input.facts.filter((fact) => fact.value.kind !== "work_authorization"),
    })),
  ),
  ...numbered("closed", 4).map((id) =>
    item(id, "ineligible", true, (input) => ({ ...input, listingState: "closed" })),
  ),
];
