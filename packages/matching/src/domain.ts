import type { CandidateFact } from "../../contracts/src/candidate.js";
import { DomainError } from "../../contracts/src/index.js";
import {
  type DeterministicGate,
  type MatchingInput,
  type MatchScore,
  matchingInputSchema,
  type Requirement,
  type SemanticProposal,
  semanticProposalSchema,
} from "../../contracts/src/matching.js";

const languageRank = new Map([
  ["unspecified", 0],
  ["A1", 1],
  ["A2", 2],
  ["B1", 3],
  ["B2", 4],
  ["C1", 5],
  ["C2", 6],
  ["native", 7],
]);

function gate(
  code: DeterministicGate["code"],
  status: DeterministicGate["status"],
  explanation: string,
  factIds: string[] = [],
): DeterministicGate {
  return { code, status, explanation, factIds };
}

function authorization(facts: CandidateFact[], country: string | undefined) {
  return facts.find(
    (fact) => fact.value.kind === "work_authorization" && fact.value.country === country,
  );
}

function languageGate(description: string, facts: CandidateFact[]): DeterministicGate {
  const required = ["Dutch", "English", "German"].filter((language) =>
    new RegExp(
      `(?:fluent|professional|business|C1|B2|required|must[^.]{0,20}speak)[^.]{0,30}\\b${language}\\b|\\b${language}\\b[^.]{0,30}(?:required|B2|C1|fluent)`,
      "i",
    ).test(description),
  );
  if (!required.length) return gate("language", "pass", "No explicit language threshold found.");
  const matches = required.map((name) =>
    facts.find(
      (fact) =>
        fact.value.kind === "language" &&
        fact.value.name.toLowerCase() === name.toLowerCase() &&
        (languageRank.get(fact.value.level) ?? 0) >= 4,
    ),
  );
  if (matches.some((match) => !match))
    return gate("language", "fail", `Missing an approved B2+ fact for ${required.join(", ")}.`);
  return gate(
    "language",
    "pass",
    `Approved language evidence covers ${required.join(", ")}.`,
    matches.flatMap((match) => (match ? [match.id] : [])),
  );
}

function salaryGate(input: MatchingInput): DeterministicGate {
  if (!input.salaryMinimum) return gate("salary", "pass", "No numeric salary floor is active.");
  const amounts = [
    ...input.job.description.matchAll(
      /(?:EUR|\u20ac)\s*(\d{4,6}|\d{2,3}(?:[.,]\d{3})|\d{2,3})(k)?\b/gi,
    ),
  ].map((match) => {
    const amount = Number((match[1] ?? "").replace(/[.,]/g, ""));
    return match[2] || amount < 1000 ? amount * 1000 : amount;
  });
  if (!amounts.length) return gate("salary", "pass", "Vacancy has no parseable annual EUR range.");
  const maximum = Math.max(...amounts);
  if (maximum >= input.salaryMinimum)
    return gate("salary", "pass", "Published salary can meet the approved floor.");
  if (input.salaryNegotiable)
    return gate(
      "salary",
      "review",
      "Published salary is below the floor but negotiation is allowed.",
    );
  return gate("salary", "fail", "Published salary is below the approved non-negotiable floor.");
}

export function deterministicGates(
  raw: MatchingInput,
  today = new Date().toISOString().slice(0, 10),
): DeterministicGate[] {
  const input = matchingInputSchema.parse(raw);
  const auth = authorization(input.facts, input.job.countryCode);
  const authFact = auth?.value.kind === "work_authorization" ? auth.value : null;
  const authStatus = !input.job.countryCode
    ? gate("work_authorization", "review", "Vacancy country is unknown.")
    : !authFact || authFact.currentlyAuthorized === "unknown"
      ? gate("work_authorization", "review", "Current work authorization is unknown.")
      : authFact.currentlyAuthorized === "no" ||
          (authFact.permitExpiresOn && authFact.permitExpiresOn < today)
        ? gate(
            "work_authorization",
            "fail",
            "Current work authorization is unavailable or expired.",
            [auth?.id ?? ""].filter(Boolean),
          )
        : gate(
            "work_authorization",
            "pass",
            "Current work authorization is approved.",
            auth ? [auth.id] : [],
          );
  const sponsorshipRestricted =
    /\b(no|without|cannot|can't|unable to)\s+(?:visa\s+)?sponsor(?:ship)?\b|\bmust (?:already )?be (?:legally )?authorized\b/i.test(
      input.job.description,
    );
  const sponsorship = !sponsorshipRestricted
    ? gate("sponsorship", "pass", "No explicit sponsorship exclusion found.")
    : authStatus.status === "pass"
      ? gate(
          "sponsorship",
          "pass",
          "Existing authorization satisfies the explicit restriction.",
          [auth?.id ?? ""].filter(Boolean),
        )
      : gate(
          "sponsorship",
          authStatus.status === "fail" ? "fail" : "review",
          "Sponsorship is restricted and current authorization is not conclusively sufficient.",
          auth ? [auth.id] : [],
        );
  return [
    gate(
      "vacancy",
      input.listingState === "open" ? "pass" : input.listingState === "closed" ? "fail" : "review",
      input.listingState === "open"
        ? "Vacancy is open in fresh source evidence."
        : `Vacancy is ${input.listingState}.`,
    ),
    gate(
      "duplicate",
      input.duplicate ? "fail" : "pass",
      input.duplicate
        ? "An existing application or history record matches."
        : "No duplicate is established.",
    ),
    gate(
      "location",
      !input.job.countryCode
        ? "review"
        : input.countries.includes(input.job.countryCode)
          ? "pass"
          : "fail",
      !input.job.countryCode
        ? "Vacancy country is unknown."
        : input.countries.includes(input.job.countryCode)
          ? "Vacancy country is within the approved scope."
          : "Vacancy country is outside the approved scope.",
    ),
    gate(
      "role",
      input.roleTerms.some((term) => input.job.title.toLowerCase().includes(term.toLowerCase()))
        ? "pass"
        : "review",
      input.roleTerms.some((term) => input.job.title.toLowerCase().includes(term.toLowerCase()))
        ? "Title matches an approved role term."
        : "Title needs semantic role review.",
    ),
    languageGate(input.job.description, input.facts),
    salaryGate(input),
    sponsorship,
    authStatus,
  ];
}

export function validateProposal(
  raw: SemanticProposal,
  description: string,
  facts: CandidateFact[],
): SemanticProposal {
  const proposal = semanticProposalSchema.parse(raw);
  const factIds = new Set(facts.map((fact) => fact.id));
  const requirementIds = new Set<string>();
  for (const requirement of proposal.requirements) {
    if (requirementIds.has(requirement.id))
      throw new DomainError("CLAIM_UNSUPPORTED", "Requirement IDs must be unique.");
    requirementIds.add(requirement.id);
    if (
      requirement.span.end <= requirement.span.start ||
      description.slice(requirement.span.start, requirement.span.end) !== requirement.span.quote
    )
      throw new DomainError("CLAIM_UNSUPPORTED", "Requirement source span is not exact.");
    if (requirement.factIds.some((id) => !factIds.has(id)))
      throw new DomainError(
        "CLAIM_UNSUPPORTED",
        "Requirement references an unknown candidate fact.",
      );
    if (requirement.status === "met" && !requirement.factIds.length)
      throw new DomainError("CLAIM_UNSUPPORTED", "A met requirement needs approved fact evidence.");
    if (requirement.status === "gap" && requirement.factIds.length)
      throw new DomainError(
        "CLAIM_UNSUPPORTED",
        "A gap cannot claim supporting candidate evidence.",
      );
  }
  return proposal;
}

export function scoreMatch(
  gates: DeterministicGate[],
  requirements: Requirement[],
  uncertainty: number,
): MatchScore {
  const required = requirements.filter((item) => item.required);
  const preferred = requirements.filter((item) => !item.required);
  const met = (items: Requirement[], empty: number) =>
    items.length ? items.filter((item) => item.status === "met").length / items.length : empty;
  const evidence = requirements.filter(
    (item) => item.status !== "met" || item.factIds.length,
  ).length;
  const score = {
    required: 40 * met(required, 0),
    preferred: 20 * met(preferred, 1),
    role: gates.find((item) => item.code === "role")?.status === "pass" ? 15 : 7.5,
    location: gates.find((item) => item.code === "location")?.status === "pass" ? 10 : 0,
    evidence: requirements.length ? 10 * (evidence / requirements.length) : 10,
    certainty: 5 * (1 - uncertainty),
    total: 0,
  };
  score.total = Object.entries(score)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, value]) => sum + value, 0);
  if (gates.some((item) => item.status === "fail")) score.total = 0;
  return Object.fromEntries(
    Object.entries(score).map(([key, value]) => [key, Math.round(value * 100) / 100]),
  ) as MatchScore;
}

export function outcome(
  gates: DeterministicGate[],
  requirements: Requirement[],
  score: MatchScore,
  uncertainty: number,
): "auto_eligible" | "ineligible" | "review" {
  if (gates.some((item) => item.status === "fail")) return "ineligible";
  if (
    gates.some((item) => item.status === "review") ||
    requirements.some((item) => item.required && item.status === "gap") ||
    uncertainty > 0.2 ||
    score.total < 75
  )
    return "review";
  return "auto_eligible";
}
