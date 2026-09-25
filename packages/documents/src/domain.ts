import { createHash } from "node:crypto";
import { chronology, usableFact } from "../../candidate/src/domain.js";
import type {
  ApprovedAnswer,
  Authorization,
  CandidateFact,
  ProfileSnapshot,
} from "../../contracts/src/candidate.js";
import {
  type AnswerProposal,
  type DocumentClaim,
  type FactReference,
  type PacketContent,
  type PacketRequestedAnswer,
  packetContentSchema,
} from "../../contracts/src/documents.js";
import type { JobInput } from "../../contracts/src/index.js";
import type { MatchAssessment, Requirement } from "../../contracts/src/matching.js";

export interface PacketGenerationInput {
  job: JobInput;
  profile: ProfileSnapshot;
  assessment: MatchAssessment;
  authorization: Authorization;
  approvedAnswers: ApprovedAnswer[];
  requestedAnswers: PacketRequestedAnswer[];
  asOf: string;
  generatedAt: string;
}

const claimId = (kind: string, value: string) =>
  `${kind}:${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
const ref = (fact: CandidateFact): FactReference => ({ factId: fact.id, revision: fact.revision });
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
const makeClaim = (
  kind: DocumentClaim["kind"],
  text: string,
  evidence: CandidateFact[],
): DocumentClaim => ({
  id: claimId(kind, `${text}:${evidence.map((fact) => `${fact.id}:${fact.revision}`).join(",")}`),
  kind,
  text: sentence(text),
  evidence: evidence.map(ref),
  origin: "deterministic",
  deliveryStatus: deliveryStatus(text),
});
const monthsLabel = (months: number) => {
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return `${years} year${years === 1 ? "" : "s"}${remainder ? ` ${remainder} months` : ""}`;
};
const uniqueValues = (facts: CandidateFact[]) => {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const value = JSON.stringify(fact.value);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

function relevantFacts(
  requirements: Requirement[],
  factsById: Map<string, CandidateFact>,
): CandidateFact[] {
  const ordered: CandidateFact[] = [];
  const seen = new Set<string>();
  for (const requirement of requirements.filter((item) => item.status === "met")) {
    for (const id of requirement.factIds) {
      const fact = factsById.get(id);
      if (fact && !seen.has(fact.id)) {
        ordered.push(fact);
        seen.add(fact.id);
      }
    }
  }
  return ordered;
}

function generateAnswers(input: PacketGenerationInput, facts: CandidateFact[]): AnswerProposal[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return input.requestedAnswers.map((request) => {
    const fields = {
      semanticKey: request.semanticKey,
      meaning: request.meaning,
      maxCharacters: request.maxCharacters,
    };
    const reusable = input.approvedAnswers
      .filter(
        (answer) =>
          answer.semanticKey === request.semanticKey &&
          answer.validFrom <= input.asOf &&
          answer.validUntil >= input.asOf &&
          (!answer.countries.length || answer.countries.includes(request.country)) &&
          (!answer.employerIds.length || answer.employerIds.includes(input.job.employerId)) &&
          (!request.maxCharacters ||
            typeof answer.answer !== "string" ||
            answer.answer.length <= request.maxCharacters),
      )
      .sort((a, b) => b.revision - a.revision)[0];
    if (reusable) {
      const evidence = Object.entries(reusable.evidenceRevisions).flatMap(([factId, revision]) =>
        byId.has(factId) ? [{ factId, revision }] : [],
      );
      return {
        ...fields,
        answer: reusable.answer,
        status: "approved_reuse" as const,
        evidence,
        approvedAnswerId: reusable.id,
        approvedAnswerRevision: reusable.revision,
      };
    }
    const authorization = facts.find(
      (fact) => fact.value.kind === "work_authorization" && fact.value.country === request.country,
    );
    if (
      /work.?authorization|right.?to.?work|sponsorship/i.test(request.semanticKey) &&
      authorization
    ) {
      const value = authorization.value;
      if (
        value.kind === "work_authorization" &&
        value.approvedWording.trim() &&
        (!request.maxCharacters || value.approvedWording.trim().length <= request.maxCharacters)
      )
        return {
          ...fields,
          answer: value.approvedWording.trim(),
          status: "deterministic" as const,
          evidence: [ref(authorization)],
          approvedAnswerId: null,
          approvedAnswerRevision: null,
        };
    }
    const availability = facts.find((fact) => fact.value.kind === "availability");
    if (/availability|start.?date|notice/i.test(request.semanticKey) && availability) {
      const value = availability.value;
      const answer =
        value.kind === "availability"
          ? value.earliestDate
            ? `Available from ${value.earliestDate}.`
            : `Notice period: ${value.noticeDays ?? "not specified"} days.`
          : null;
      if (answer && (!request.maxCharacters || answer.length <= request.maxCharacters))
        return {
          ...fields,
          answer,
          status: "deterministic" as const,
          evidence: [ref(availability)],
          approvedAnswerId: null,
          approvedAnswerRevision: null,
        };
    }
    return {
      ...fields,
      answer: null,
      status: "deferred" as const,
      evidence: [],
      approvedAnswerId: null,
      approvedAnswerRevision: null,
    };
  });
}

export function generatePacketContent(input: PacketGenerationInput): PacketContent {
  if (input.profile.id !== input.assessment.profileId)
    throw new Error("Assessment and packet profile revisions do not match.");
  if (input.authorization.profileVersionId !== input.profile.id)
    throw new Error("Authorization is not bound to the packet profile.");
  const facts = input.profile.facts.filter((fact) => usableFact(fact, input.asOf));
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const identity = facts.find((fact) => fact.value.kind === "identity");
  if (identity?.value.kind !== "identity") throw new Error("A reviewed identity is required.");
  const relevant = relevantFacts(input.assessment.requirements, factsById);
  const professional = relevant.filter((fact) => fact.value.kind === "employment");
  const skills = relevant.filter((fact) => fact.value.kind === "skill");
  const projects = relevant.filter((fact) => fact.value.kind === "project");
  const selectedProjects = projects.filter((project) =>
    input.assessment.requirements.some(
      (requirement) =>
        requirement.status === "met" &&
        requirement.factIds.includes(project.id) &&
        !requirement.factIds.some((id) => factsById.get(id)?.value.kind === "employment"),
    ),
  );
  const employment = uniqueValues(facts.filter((fact) => fact.value.kind === "employment"));
  const education = uniqueValues(facts.filter((fact) => fact.value.kind === "education"));
  const languages = uniqueValues(facts.filter((fact) => fact.value.kind === "language"));
  const allSkills = uniqueValues(facts.filter((fact) => fact.value.kind === "skill"));
  const selectedEmployment = professional.length ? professional : employment.slice(0, 1);
  const orderedSkills = [
    ...skills,
    ...allSkills.filter((fact) => !skills.some((selected) => selected.id === fact.id)),
  ];
  const primaryEmployment = professional[0] ?? employment[0];
  const summaryFacts = [
    ...(primaryEmployment ? [primaryEmployment] : []),
    ...orderedSkills.slice(0, 3),
  ];
  if (!summaryFacts.length) throw new Error("At least one employment or skill fact is required.");
  const skillNames = orderedSkills
    .slice(0, 3)
    .flatMap((fact) => (fact.value.kind === "skill" ? [fact.value.name] : []));
  const employmentLabel =
    primaryEmployment?.value.kind === "employment"
      ? `${primaryEmployment.value.title} at ${primaryEmployment.value.employer}`
      : `Verified skills include ${skillNames.join(", ")}`;
  const summary = makeClaim(
    "summary",
    `${employmentLabel}${primaryEmployment && skillNames.length ? ` with evidence in ${skillNames.join(", ")}` : ""}`,
    summaryFacts,
  );
  const timeline = chronology(facts, input.asOf);
  const fullTimeFacts = employment.filter(
    (fact) => fact.value.kind === "employment" && fact.value.workload === "full_time",
  );
  const experienceFacts = employment.length ? employment : summaryFacts;
  const professionalClaim = makeClaim(
    "experience_total",
    `${monthsLabel(timeline.fullTimeMonths)} of full-time professional experience`,
    fullTimeFacts.length ? fullTimeFacts : experienceFacts,
  );
  const handsOnClaim = makeClaim(
    "experience_total",
    `${monthsLabel(timeline.totalMonths)} of hands-on employment experience`,
    experienceFacts,
  );
  const contributions = selectedEmployment
    .flatMap((fact) =>
      fact.value.kind === "employment"
        ? [makeClaim("employment", fact.value.description, [fact])]
        : [],
    )
    .filter((claim) => claim.text.length > 1)
    .slice(0, 3);
  if (!contributions.length)
    contributions.push(
      ...selectedProjects
        .map((fact) =>
          fact.value.kind === "project"
            ? makeClaim("project", `${fact.value.name}: ${fact.value.description}`, [fact])
            : null,
        )
        .filter((claim): claim is DocumentClaim => Boolean(claim))
        .slice(0, 3),
    );
  if (!contributions.length) contributions.push(summary);
  const matchedRequirement = input.assessment.requirements.find((item) => item.status === "met");
  const availability = facts.find((fact) => fact.value.kind === "availability");
  const practical =
    availability?.value.kind === "availability"
      ? makeClaim(
          "availability",
          availability.value.earliestDate
            ? `Available from ${availability.value.earliestDate}`
            : `Notice period is ${availability.value.noticeDays ?? "not specified"} days`,
          [availability],
        )
      : null;
  const content: PacketContent = {
    schemaVersion: 1,
    job: {
      id: input.job.id,
      company: input.job.company,
      role: input.job.title,
      url: input.job.url,
    },
    profileId: input.profile.id,
    profileRevision: input.profile.revision,
    assessmentId: input.assessment.id,
    generatedAt: input.generatedAt,
    cv: {
      kind: "cv",
      templateVersion: "cv-v1",
      identity: {
        fullName: identity.value.fullName,
        email: identity.value.email,
        phone: identity.value.phone,
        links: identity.value.links,
        evidence: [ref(identity)],
      },
      summary,
      employment: employment.flatMap((fact) => {
        if (fact.value.kind !== "employment") return [];
        const selected = selectedEmployment.some(
          (item) => JSON.stringify(item.value) === JSON.stringify(fact.value),
        );
        return [
          {
            factId: fact.id,
            revision: fact.revision,
            employer: fact.value.employer,
            title: fact.value.title,
            start: fact.value.start,
            end: fact.value.end,
            workload: fact.value.workload,
            bullets: selected ? [makeClaim("employment", fact.value.description, [fact])] : [],
          },
        ];
      }),
      education: education.flatMap((fact) =>
        fact.value.kind === "education"
          ? [
              {
                factId: fact.id,
                revision: fact.revision,
                institution: fact.value.institution,
                qualification: fact.value.qualification,
                start: fact.value.start,
                end: fact.value.end,
              },
            ]
          : [],
      ),
      skills: orderedSkills.flatMap((fact) =>
        fact.value.kind === "skill" ? [makeClaim("skill", fact.value.name, [fact])] : [],
      ),
      languages: languages.flatMap((fact) =>
        fact.value.kind === "language"
          ? [makeClaim("language", `${fact.value.name}: ${fact.value.level}`, [fact])]
          : [],
      ),
      projects: selectedProjects.flatMap((fact) =>
        fact.value.kind === "project"
          ? [makeClaim("project", `${fact.value.name}: ${fact.value.description}`, [fact])]
          : [],
      ),
      experience: { professional: professionalClaim, handsOn: handsOnClaim },
    },
    letter: {
      kind: "motivation_letter",
      templateVersion: "letter-v1",
      company: input.job.company,
      role: input.job.title,
      salutation: `Hiring team at ${input.job.company}`,
      opening: `I am applying for the ${input.job.title} role at ${input.job.company}.`,
      contributions,
      motivation: matchedRequirement
        ? `The role's focus on ${matchedRequirement.span.quote} is supported by the evidence highlighted above.`
        : `The responsibilities described for the ${input.job.title} role are the basis for this application.`,
      practical,
      closing: `Sincerely,\n${identity.value.fullName}`,
    },
    answers: generateAnswers(input, facts),
    changeSummary: {
      reorderedSkills: orderedSkills.flatMap((fact) =>
        fact.value.kind === "skill" ? [fact.value.name] : [],
      ),
      selectedEvidence: [
        ...selectedEmployment.map(
          (fact) => `Employment evidence ${fact.id} selected before projects.`,
        ),
        ...skills.map((fact) => `Skill evidence ${fact.id} selected for a matched requirement.`),
        ...selectedProjects.map(
          (fact) => `Project evidence ${fact.id} fills an uncovered requirement.`,
        ),
      ],
      excludedEvidence: projects
        .filter((fact) => !selectedProjects.some((selected) => selected.id === fact.id))
        .map(
          (fact) =>
            `Project evidence ${fact.id} excluded because professional evidence was available.`,
        ),
      summaryChanges: [
        `Summary tailored to ${input.job.title} using ${summary.evidence.length} approved facts.`,
      ],
    },
  };
  return packetContentSchema.parse(content);
}
