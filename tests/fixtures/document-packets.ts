import type {
  ApprovedAnswer,
  Authorization,
  CandidateFact,
  ProfileSnapshot,
} from "../../packages/contracts/src/candidate.js";
import type { JobInput } from "../../packages/contracts/src/index.js";
import type { MatchAssessment } from "../../packages/contracts/src/matching.js";
import type { PacketGenerationInput } from "../../packages/documents/src/domain.js";

const base = {
  key: "synthetic",
  revision: 1,
  status: "verified" as const,
  provenance: { kind: "owner" as const, statement: "Reviewed synthetic fixture." },
  expiresOn: null,
  recordedAt: "2026-09-16T00:00:00.000Z",
  reviewedAt: "2026-09-16T00:00:00.000Z",
};
export const documentFacts: CandidateFact[] = [
  {
    ...base,
    id: "fact-identity",
    key: "identity",
    value: {
      kind: "identity",
      fullName: "Zoë Jansen",
      email: "zoe@synthetic.example",
      phone: "+31 20 000 0000",
      links: ["https://portfolio.synthetic.example/a-very-long-but-valid-profile-path"],
    },
  },
  {
    ...base,
    id: "fact-employment-full",
    key: "employment-one",
    value: {
      kind: "employment",
      employer: "Synthetic Systems Nederland B.V.",
      title: "Software Engineer",
      start: "2022-01",
      end: "2024-12",
      workload: "full_time",
      description: "Built and maintained Python services with reviewed release controls.",
    },
  },
  {
    ...base,
    id: "fact-employment-part",
    key: "employment-two",
    value: {
      kind: "employment",
      employer: "Résumé Research Cooperative",
      title: "Research Assistant",
      start: "2020-01",
      end: "2021-12",
      workload: "part_time",
      description: "Researched data-quality methods and prototyped a validation workflow.",
    },
  },
  {
    ...base,
    id: "fact-education",
    key: "education-one",
    value: {
      kind: "education",
      institution: "Synthetic Technical University",
      qualification: "MSc Computer Science",
      start: "2018-09",
      end: "2020-07",
    },
  },
  {
    ...base,
    id: "fact-python",
    key: "skill-python",
    value: { kind: "skill", name: "Python", firstUsed: "2020-01" },
  },
  {
    ...base,
    id: "fact-postgresql",
    key: "skill-postgresql",
    value: { kind: "skill", name: "PostgreSQL", firstUsed: "2021-03" },
  },
  {
    ...base,
    id: "fact-language",
    key: "language-english",
    value: { kind: "language", name: "English", level: "C1" },
  },
  {
    ...base,
    id: "fact-project",
    key: "project-one",
    value: {
      kind: "project",
      name: "Synthetic Side Project",
      description: "Prototyped a Python queue inspector; it was not deployed.",
      start: "2025-01",
      end: "2025-06",
    },
  },
  {
    ...base,
    id: "fact-availability",
    key: "availability",
    value: { kind: "availability", earliestDate: "2026-11-01", noticeDays: 30 },
  },
  {
    ...base,
    id: "fact-work-nl",
    key: "work-nl",
    value: {
      kind: "work_authorization",
      country: "NL",
      currentlyAuthorized: "yes",
      permitExpiresOn: "2028-01-01",
      futureSponsorship: "no",
      approvedWording: "Authorized to work in the Netherlands without sponsorship.",
    },
  },
];

export const documentProfile: ProfileSnapshot = {
  id: "profile-documents",
  revision: 3,
  candidateId: "candidate-documents",
  facts: documentFacts,
  sha256: "a".repeat(64),
  createdAt: "2026-09-16T00:00:00.000Z",
};

export const documentJob: JobInput = {
  id: "job-documents",
  employerId: "employer-northstar",
  requisitionId: "NS-42",
  title: "Python Platform Engineer",
  company: "Northstar Systems",
  location: "Amsterdam, Netherlands",
  countryCode: "NL",
  url: "https://jobs.synthetic.example/northstar/python-platform-engineer",
  description: "We require Python for reliable platform services and value PostgreSQL experience.",
  source: "synthetic fixture",
  synthetic: true,
};

const gates = [
  "vacancy",
  "duplicate",
  "location",
  "role",
  "language",
  "salary",
  "sponsorship",
  "work_authorization",
] as const;
export const documentAssessment: MatchAssessment = {
  id: "assessment-documents",
  revision: 1,
  jobId: documentJob.id,
  applicationId: "application-documents",
  profileId: documentProfile.id,
  outcome: "auto_eligible",
  gates: gates.map((code) => ({
    code,
    status: "pass",
    explanation: `${code} passed.`,
    factIds: [],
  })),
  requirements: [
    {
      id: "requirement-python",
      kind: "skill",
      required: true,
      text: "Python",
      span: { start: 11, end: 17, quote: "Python" },
      status: "met",
      factIds: ["fact-employment-full", "fact-python"],
      explanation: "Employment and skill evidence support Python.",
    },
    {
      id: "requirement-postgresql",
      kind: "skill",
      required: false,
      text: "PostgreSQL",
      span: { start: 61, end: 71, quote: "PostgreSQL" },
      status: "met",
      factIds: ["fact-postgresql", "fact-project"],
      explanation: "Reviewed facts support PostgreSQL and adjacent project work.",
    },
  ],
  score: {
    required: 40,
    preferred: 15,
    role: 15,
    location: 10,
    evidence: 10,
    certainty: 5,
    total: 95,
  },
  modelId: null,
  provider: null,
  explanation: "Synthetic deterministic assessment.",
  createdAt: "2026-09-17T08:00:00.000Z",
};

export const documentAuthorization: Authorization = {
  id: "authorization-documents",
  revision: 2,
  candidateId: documentProfile.candidateId,
  expectedRevision: 1,
  mode: "auto_submit",
  profileVersionId: documentProfile.id,
  roleTerms: ["Platform Engineer"],
  countries: ["NL"],
  blockedEmployerIds: [],
  dailyLimit: 5,
  allowAccountCreation: false,
  allowOptionalDisclosures: false,
  sponsorshipWording: "No sponsorship is required.",
  salary: null,
  salaryNegotiable: null,
  effectiveAt: "2026-09-16T00:00:00.000Z",
  expiresAt: "2026-10-16T00:00:00.000Z",
  autoSubmitAcknowledged: true,
  revokedAt: null,
};

export const documentAnswers: ApprovedAnswer[] = [
  {
    id: "answer-work-auth",
    semanticKey: "right_to_work",
    meaning: "Right to work in the Netherlands",
    answer: "Yes",
    validFrom: "2026-01-01",
    validUntil: "2027-01-01",
    employerIds: [],
    countries: ["NL"],
    evidenceFactIds: ["fact-work-nl"],
    revision: 1,
    approvedAt: "2026-09-16T00:00:00.000Z",
    evidenceRevisions: { "fact-work-nl": 1 },
  },
];

export function documentGenerationInput(): PacketGenerationInput {
  return {
    job: documentJob,
    profile: documentProfile,
    assessment: documentAssessment,
    authorization: documentAuthorization,
    approvedAnswers: documentAnswers,
    requestedAnswers: [
      {
        semanticKey: "right_to_work",
        meaning: "Are you authorized to work in the Netherlands?",
        maxCharacters: 10,
        country: "NL",
      },
      {
        semanticKey: "why_this_company",
        meaning: "Why do you want to join us?",
        maxCharacters: 500,
        country: "NL",
      },
    ],
    asOf: "2026-09-17",
    generatedAt: "2026-09-17T09:00:00.000Z",
  };
}
