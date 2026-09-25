import { chronology, usableFact } from "../../candidate/src/domain.js";
import type { CandidateFact, ProfileSnapshot } from "../../contracts/src/candidate.js";
import {
  type DocumentClaim,
  type PacketContent,
  type ValidationIssue,
  type ValidationReport,
  validationReportSchema,
} from "../../contracts/src/documents.js";
import type { MatchAssessment } from "../../contracts/src/matching.js";

const placeholder = /\[(?:insert|company|role|name|date)[^\]]*\]|\{\{[^}]+\}\}|\bTBD\b|<[^>]+>/i;
const monthsLabel = (months: number) => {
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return `${years} year${years === 1 ? "" : "s"}${remainder ? ` ${remainder} months` : ""}`;
};
const sentence = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};
const deliveryStatus = (value: string): DocumentClaim["deliveryStatus"] => {
  const text = value.toLowerCase();
  if (/\bcurrently (?:developing|building)|\bin development\b/.test(text)) return "developing";
  if (/\bprototyp(?:e|ed|ing)\b/.test(text)) return "prototyped";
  if (/\bresearch(?:ed|ing)?\b/.test(text)) return "researched";
  if (/\bmaintain(?:ed|ing)?\b/.test(text)) return "maintained";
  if (/\bdeploy(?:ed|ing|ment)?\b/.test(text)) return "deployed";
  if (/\bbuilt?\b|\bimplemented\b|\bcreated\b/.test(text)) return "built";
  return null;
};

function supportedClaim(claim: DocumentClaim, facts: CandidateFact[]): boolean {
  if (claim.kind === "experience_total") return true;
  if (claim.kind === "summary") {
    const employment = facts.find((fact) => fact.value.kind === "employment");
    const skills = facts.flatMap((fact) => (fact.value.kind === "skill" ? [fact.value.name] : []));
    const expected =
      employment?.value.kind === "employment"
        ? `${employment.value.title} at ${employment.value.employer}${skills.length ? ` with evidence in ${skills.join(", ")}` : ""}`
        : `Verified skills include ${skills.join(", ")}`;
    return claim.text === sentence(expected);
  }
  return facts.some((fact) => {
    const value = fact.value;
    switch (claim.kind) {
      case "employment":
        return value.kind === "employment" && claim.text === sentence(value.description);
      case "education":
        return (
          value.kind === "education" &&
          claim.text === sentence(`${value.qualification}, ${value.institution}`)
        );
      case "skill":
        return value.kind === "skill" && claim.text === sentence(value.name);
      case "language":
        return (
          value.kind === "language" && claim.text === sentence(`${value.name}: ${value.level}`)
        );
      case "project":
        return (
          value.kind === "project" && claim.text === sentence(`${value.name}: ${value.description}`)
        );
      case "metric":
        return (
          value.kind === "metric" &&
          claim.text ===
            sentence(`${value.statement}: ${value.value} ${value.unit} (${value.context})`)
        );
      case "availability":
        return (
          value.kind === "availability" &&
          claim.text ===
            sentence(
              value.earliestDate
                ? `Available from ${value.earliestDate}`
                : `Notice period is ${value.noticeDays ?? "not specified"} days`,
            )
        );
      case "authorization":
        return (
          value.kind === "work_authorization" && claim.text === sentence(value.approvedWording)
        );
      case "identity":
        return value.kind === "identity" && claim.text === sentence(value.fullName);
      default:
        return false;
    }
  });
}

function claims(content: PacketContent): Array<{ path: string; claim: DocumentClaim }> {
  return [
    { path: "cv.summary", claim: content.cv.summary },
    { path: "cv.experience.professional", claim: content.cv.experience.professional },
    { path: "cv.experience.handsOn", claim: content.cv.experience.handsOn },
    ...content.cv.employment.flatMap((entry, index) =>
      entry.bullets.map((claim, bullet) => ({
        path: `cv.employment.${index}.bullets.${bullet}`,
        claim,
      })),
    ),
    ...content.cv.skills.map((claim, index) => ({ path: `cv.skills.${index}`, claim })),
    ...content.cv.languages.map((claim, index) => ({ path: `cv.languages.${index}`, claim })),
    ...content.cv.projects.map((claim, index) => ({ path: `cv.projects.${index}`, claim })),
    ...content.letter.contributions.map((claim, index) => ({
      path: `letter.contributions.${index}`,
      claim,
    })),
    ...(content.letter.practical
      ? [{ path: "letter.practical", claim: content.letter.practical }]
      : []),
  ];
}

export function validatePacketContent(input: {
  content: PacketContent;
  profile: ProfileSnapshot;
  assessment: MatchAssessment;
  asOf: string;
  checkedAt: string;
}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue) => issues.push(issue);
  const facts = new Map(input.profile.facts.map((fact) => [fact.id, fact]));
  const allClaims = claims(input.content);
  for (const { path, claim } of allClaims) {
    for (const evidence of claim.evidence) {
      const fact = facts.get(evidence.factId);
      if (!fact)
        add({
          code: "EVIDENCE_MISSING",
          severity: "error",
          path,
          message: `Claim references missing fact ${evidence.factId}.`,
        });
      else if (fact.revision !== evidence.revision || !usableFact(fact, input.asOf))
        add({
          code: "EVIDENCE_STALE",
          severity: "error",
          path,
          message: `Claim evidence ${evidence.factId} is stale or not approved.`,
        });
    }
    const sourceFacts = claim.evidence.flatMap((item) => {
      const fact = facts.get(item.factId);
      return fact ? [fact] : [];
    });
    if (!supportedClaim(claim, sourceFacts) || claim.deliveryStatus !== deliveryStatus(claim.text))
      add({
        code: "CLAIM_UNSUPPORTED",
        severity: "error",
        path,
        message: "Claim wording cannot be reconstructed from its approved evidence.",
      });
    if (
      deliveryStatus(claim.text) === "deployed" &&
      sourceFacts.some((fact) =>
        fact.value.kind === "project" || fact.value.kind === "employment"
          ? /\bprototyp(?:e|ed|ing)\b|\bin development\b|\bcurrently developing\b/i.test(
              fact.value.description,
            )
          : false,
      )
    )
      add({
        code: "DELIVERY_UPGRADED",
        severity: "error",
        path,
        message: "Prototype or in-development evidence cannot support a deployed claim.",
      });
    if (placeholder.test(claim.text))
      add({
        code: "PLACEHOLDER_PRESENT",
        severity: "error",
        path,
        message: "Generated claim contains an unresolved placeholder or markup.",
      });
  }
  for (const [path, text] of [
    ["letter.opening", input.content.letter.opening],
    ["letter.motivation", input.content.letter.motivation],
    ["letter.closing", input.content.letter.closing],
  ] as const)
    if (placeholder.test(text))
      add({
        code: "PLACEHOLDER_PRESENT",
        severity: "error",
        path,
        message: "Generated document contains an unresolved placeholder or markup.",
      });
  if (
    input.content.job.company !== input.content.letter.company ||
    input.content.job.role !== input.content.letter.role ||
    !input.content.letter.opening.includes(input.content.job.company) ||
    !input.content.letter.opening.includes(input.content.job.role)
  )
    add({
      code: "VACANCY_MISMATCH",
      severity: "error",
      path: "letter",
      message: "Letter company or role does not match the bound vacancy.",
    });
  const identityRef = input.content.cv.identity.evidence[0];
  const identity = identityRef ? facts.get(identityRef.factId) : undefined;
  if (
    identity?.value.kind !== "identity" ||
    identity.revision !== identityRef?.revision ||
    identity.value.fullName !== input.content.cv.identity.fullName ||
    identity.value.email !== input.content.cv.identity.email ||
    identity.value.phone !== input.content.cv.identity.phone
  )
    add({
      code: "CLAIM_UNSUPPORTED",
      severity: "error",
      path: "cv.identity",
      message: "Rendered identity differs from its approved fact.",
    });
  for (const [index, entry] of input.content.cv.employment.entries()) {
    const fact = facts.get(entry.factId);
    if (
      !fact ||
      fact.revision !== entry.revision ||
      fact.value.kind !== "employment" ||
      fact.value.employer !== entry.employer ||
      fact.value.title !== entry.title ||
      fact.value.start !== entry.start ||
      fact.value.end !== entry.end ||
      fact.value.workload !== entry.workload
    )
      add({
        code: "CLAIM_UNSUPPORTED",
        severity: "error",
        path: `cv.employment.${index}`,
        message: "Employment identity, title, dates or workload differ from the approved fact.",
      });
  }
  const timeline = chronology(input.profile.facts, input.asOf);
  const expectedProfessional = `${monthsLabel(timeline.fullTimeMonths)} of full-time professional experience.`;
  const expectedHandsOn = `${monthsLabel(timeline.totalMonths)} of hands-on employment experience.`;
  if (
    input.content.cv.experience.professional.text !== expectedProfessional ||
    input.content.cv.experience.handsOn.text !== expectedHandsOn ||
    (expectedProfessional ===
      expectedHandsOn.replace("hands-on employment", "full-time professional") &&
      timeline.fullTimeMonths !== timeline.totalMonths)
  )
    add({
      code: "EXPERIENCE_CONFLATED",
      severity: "error",
      path: "cv.experience",
      message: "Hands-on and full-time professional experience totals must remain distinct.",
    });
  for (const [index, answer] of input.content.answers.entries()) {
    if (answer.status === "deferred")
      add({
        code: "ANSWER_DEFERRED",
        severity: "warning",
        path: `answers.${index}`,
        message: `Substantive answer ${answer.semanticKey} requires owner input.`,
      });
    if (
      answer.maxCharacters &&
      typeof answer.answer === "string" &&
      answer.answer.length > answer.maxCharacters
    )
      add({
        code: "ANSWER_TOO_LONG",
        severity: "error",
        path: `answers.${index}`,
        message: `Answer ${answer.semanticKey} exceeds the employer limit.`,
      });
  }
  if (input.assessment.outcome === "ineligible")
    add({
      code: "CLAIM_UNSUPPORTED",
      severity: "error",
      path: "assessment",
      message: "An ineligible assessment cannot produce an application-ready packet.",
    });
  const status = issues.some((issue) => issue.severity === "error")
    ? "blocked"
    : issues.some((issue) => issue.code === "ANSWER_DEFERRED")
      ? "needs_input"
      : "valid";
  return validationReportSchema.parse({
    validatorVersion: "packet-validator-v1",
    status,
    issues,
    checkedClaimIds: allClaims.map(({ claim }) => claim.id),
    checkedAt: input.checkedAt,
  });
}

export function factText(fact: CandidateFact): string {
  return JSON.stringify(fact.value);
}
