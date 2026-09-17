import { z } from "zod";
import { factSchema } from "./candidate.js";
import { idSchema, jobInputSchema } from "./index.js";

const bounded = z.string().trim().min(1).max(4000);
export const modelCatalogueSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string().min(1).max(240),
            name: z.string().max(240).optional(),
            context_length: z.number().int().positive().nullable().optional(),
            architecture: z
              .object({
                input_modalities: z.array(z.string().max(40)).max(20),
                output_modalities: z.array(z.string().max(40)).max(20),
              })
              .passthrough(),
            pricing: z.record(z.string().max(80), z.unknown()),
            supported_parameters: z.array(z.string().max(80)).max(200),
          })
          .passthrough(),
      )
      .max(2000),
  })
  .strict();
export type CatalogueModel = z.infer<typeof modelCatalogueSchema>["data"][number];

export const routePolicySchema = z
  .object({
    modelAllowlist: z.array(z.string().max(240)).min(1).max(100),
    providerAllowlist: z.array(z.string().max(120)).min(1).max(100),
    minimumContext: z.number().int().min(4096).max(1000000).default(8192),
    catalogueMaxAgeSeconds: z.number().int().min(60).max(86400).default(21600),
    dailyLimit: z.number().int().min(1).max(50),
  })
  .strict();
export type RoutePolicy = z.infer<typeof routePolicySchema>;

export const routeDecisionSchema = z
  .object({
    eligible: z.boolean(),
    modelId: z.string().max(240),
    provider: z.string().max(120).nullable(),
    reasons: z.array(z.string().max(240)).max(50),
    catalogueFetchedAt: z.iso.datetime(),
  })
  .strict();
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export const deterministicGateSchema = z
  .object({
    code: z.enum([
      "vacancy",
      "duplicate",
      "location",
      "role",
      "language",
      "salary",
      "sponsorship",
      "work_authorization",
    ]),
    status: z.enum(["pass", "fail", "review"]),
    explanation: bounded,
    factIds: z.array(idSchema).max(30),
  })
  .strict();
export type DeterministicGate = z.infer<typeof deterministicGateSchema>;

export const requirementSchema = z
  .object({
    id: idSchema,
    kind: z.enum([
      "skill",
      "experience",
      "education",
      "language",
      "location",
      "salary",
      "sponsorship",
      "responsibility",
      "other",
    ]),
    required: z.boolean(),
    text: bounded,
    span: z
      .object({ start: z.number().int().min(0), end: z.number().int().positive(), quote: bounded })
      .strict(),
    status: z.enum(["met", "gap", "uncertain"]),
    factIds: z.array(idSchema).max(30),
    explanation: bounded,
  })
  .strict();
export type Requirement = z.infer<typeof requirementSchema>;

export const semanticProposalSchema = z
  .object({
    requirements: z.array(requirementSchema).max(100),
    uncertainty: z.number().min(0).max(1),
    summary: bounded,
  })
  .strict();
export type SemanticProposal = z.infer<typeof semanticProposalSchema>;

export const scoreSchema = z
  .object({
    required: z.number().min(0).max(40),
    preferred: z.number().min(0).max(20),
    role: z.number().min(0).max(15),
    location: z.number().min(0).max(10),
    evidence: z.number().min(0).max(10),
    certainty: z.number().min(0).max(5),
    total: z.number().min(0).max(100),
  })
  .strict();
export type MatchScore = z.infer<typeof scoreSchema>;

export const assessmentSchema = z
  .object({
    id: idSchema,
    revision: z.number().int().positive(),
    jobId: idSchema,
    applicationId: idSchema.nullable(),
    profileId: idSchema,
    outcome: z.enum(["auto_eligible", "ineligible", "review", "inference_paused"]),
    gates: z.array(deterministicGateSchema).length(8),
    requirements: z.array(requirementSchema).max(100),
    score: scoreSchema,
    modelId: z.string().max(240).nullable(),
    provider: z.string().max(120).nullable(),
    explanation: bounded,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type MatchAssessment = z.infer<typeof assessmentSchema>;

export const matchingInputSchema = z
  .object({
    job: jobInputSchema,
    facts: z.array(factSchema).max(1000),
    profileId: idSchema,
    roleTerms: z.array(z.string().trim().min(2).max(120)).min(1).max(50),
    countries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(30),
    salaryMinimum: z.number().positive().nullable(),
    salaryNegotiable: z.boolean().nullable(),
    listingState: z.enum(["open", "missing", "closed"]),
    duplicate: z.boolean(),
  })
  .strict();
export type MatchingInput = z.infer<typeof matchingInputSchema>;

export interface MatchingSnapshot {
  route: {
    status: "fixture" | "ready" | "paused" | "rate_limited" | "unconfigured";
    modelId: string | null;
    provider: string | null;
    lastCatalogueAt: string | null;
    backoffUntil: string | null;
    reason: string;
  };
  budget: { day: string; limit: number; used: number; reserved: number };
  assessments: MatchAssessment[];
}
