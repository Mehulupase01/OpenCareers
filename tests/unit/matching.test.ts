import { describe, expect, it } from "vitest";
import type { CandidateFact } from "../../packages/contracts/src/candidate.js";
import type { MatchingInput, SemanticProposal } from "../../packages/contracts/src/matching.js";
import { assertNoTools, modelReasons, selectRoute } from "../../packages/inference/src/policy.js";
import {
  deterministicGates,
  outcome,
  scoreMatch,
  validateProposal,
} from "../../packages/matching/src/domain.js";

const skill: CandidateFact = {
  id: "fact-python",
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
  id: "fact-english",
  key: "language-english",
  value: { kind: "language", name: "English", level: "C1" },
};
const work: CandidateFact = {
  ...skill,
  id: "fact-work-nl",
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
const description =
  "Build Python services. Fluent English required. EUR 70,000 - EUR 90,000. No visa sponsorship.";
const input: MatchingInput = {
  job: {
    id: "job-1",
    employerId: "employer-1",
    requisitionId: "req-1",
    title: "Python Software Engineer",
    company: "Synthetic Employer",
    location: "Amsterdam, Netherlands",
    countryCode: "NL",
    url: "https://synthetic.example/jobs/1",
    description,
    source: "fixture",
    synthetic: true,
  },
  facts: [skill, language, work],
  profileId: "profile-1",
  roleTerms: ["Software Engineer"],
  countries: ["NL"],
  salaryMinimum: 80000,
  salaryNegotiable: false,
  listingState: "open",
  duplicate: false,
};

const free = {
  id: "synthetic/model:free",
  name: "Synthetic free model",
  context_length: 16000,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  pricing: { prompt: "0", completion: "0" },
  supported_parameters: ["structured_outputs", "response_format"],
};
const routePolicy = {
  modelAllowlist: [free.id],
  providerAllowlist: ["synthetic-provider"],
  minimumContext: 8192,
  catalogueMaxAgeSeconds: 21600,
  dailyLimit: 10,
};

describe("free-only inference policy", () => {
  it("accepts only a fresh allowlisted explicit zero-price structured route", () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    expect(selectRoute({ data: [free] }, routePolicy, "2026-09-16T11:00:00.000Z", now)).toEqual({
      eligible: true,
      modelId: free.id,
      provider: "synthetic-provider",
      reasons: [],
      catalogueFetchedAt: "2026-09-16T11:00:00.000Z",
    });
    expect(
      selectRoute({ data: [free] }, routePolicy, "2026-09-15T11:00:00.000Z", now).eligible,
    ).toBe(false);
  });
  it("rejects paid, unknown, tiered and tool-enabled routes before inference", () => {
    expect(
      modelReasons(
        { ...free, id: "synthetic/paid", pricing: { prompt: "0.1", completion: "0" } },
        routePolicy,
      ).join(" "),
    ).toMatch(/free|zero/);
    expect(
      modelReasons({ ...free, pricing: { prompt: "0", completion: null } }, routePolicy).join(" "),
    ).toMatch(/Unknown completion/);
    expect(
      modelReasons(
        { ...free, pricing: { prompt: "0", completion: "0", future_price: "0" } },
        routePolicy,
      ).join(" "),
    ).toMatch(/Unknown price dimension/);
    expect(
      modelReasons(
        { ...free, pricing: { prompt: "0", completion: "0", overrides: [] } },
        routePolicy,
      ).join(" "),
    ).toMatch(/overrides/);
    expect(() => assertNoTools({ tools: [] })).toThrow(/disabled/);
  });
});

describe("deterministic and evidence-bound matching", () => {
  it("passes supported constraints and blocks hard disqualifiers without inference", () => {
    expect(deterministicGates(input, "2026-09-16").every((gate) => gate.status === "pass")).toBe(
      true,
    );
    const outside = deterministicGates({ ...input, countries: ["DE"] }, "2026-09-16");
    expect(outside.find((gate) => gate.code === "location")?.status).toBe("fail");
    const duplicate = deterministicGates({ ...input, duplicate: true }, "2026-09-16");
    expect(duplicate.find((gate) => gate.code === "duplicate")?.status).toBe("fail");
    const languageGap = deterministicGates({ ...input, facts: [skill, work] }, "2026-09-16");
    expect(languageGap.find((gate) => gate.code === "language")?.status).toBe("fail");
  });
  it("rejects schema-valid unsupported facts and inexact source spans", () => {
    const start = description.indexOf("Python");
    const proposal: SemanticProposal = {
      requirements: [
        {
          id: "requirement-1",
          kind: "skill",
          required: true,
          text: "Python",
          span: { start, end: start + 6, quote: "Python" },
          status: "met",
          factIds: [skill.id],
          explanation: "The approved skill fact maps to the exact requirement.",
        },
      ],
      uncertainty: 0.1,
      summary: "One supported required skill.",
    };
    const requirement = proposal.requirements.at(0);
    if (!requirement) throw new Error("Expected synthetic requirement.");
    expect(validateProposal(proposal, description, input.facts)).toEqual(proposal);
    expect(() =>
      validateProposal(
        {
          ...proposal,
          requirements: [{ ...requirement, factIds: ["invented-fact"] }],
        },
        description,
        input.facts,
      ),
    ).toThrow(/unknown candidate fact/);
    expect(() =>
      validateProposal(
        {
          ...proposal,
          requirements: [
            {
              ...requirement,
              span: { start, end: start + 5, quote: "Python" },
            },
          ],
        },
        description,
        input.facts,
      ),
    ).toThrow(/source span/);
  });
  it("computes the final score in code and keeps uncertainty outside auto eligibility", () => {
    const gates = deterministicGates(input, "2026-09-16");
    const start = description.indexOf("Python");
    const requirements = [
      {
        id: "requirement-1",
        kind: "skill" as const,
        required: true,
        text: "Python",
        span: { start, end: start + 6, quote: "Python" },
        status: "met" as const,
        factIds: [skill.id],
        explanation: "Supported.",
      },
    ];
    const score = scoreMatch(gates, requirements, 0.1);
    expect(score.total).toBeGreaterThanOrEqual(90);
    expect(outcome(gates, requirements, score, 0.1)).toBe("auto_eligible");
    expect(outcome(gates, requirements, score, 0.5)).toBe("review");
    expect(scoreMatch(deterministicGates({ ...input, duplicate: true }), [], 1).total).toBe(0);
  });
});
