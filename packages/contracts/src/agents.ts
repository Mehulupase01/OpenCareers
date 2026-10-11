import { z } from "zod";

export const allocationLimits = {
  semantic_triage: 5,
  packet_drafting: 13,
  independent_critique: 13,
  form_questions: 4,
  repairs: 5,
  health_probes: 2,
  unallocated_reserve: 8,
} as const;
export const allocationClassSchema = z.enum(
  Object.keys(allocationLimits) as [
    keyof typeof allocationLimits,
    ...(keyof typeof allocationLimits)[],
  ],
);
export type AllocationClass = z.infer<typeof allocationClassSchema>;
export const nodeKindSchema = z.enum([
  "extractor",
  "match_analyst",
  "drafter",
  "form_answer_planner",
  "critic",
  "repair",
]);
export type NodeKind = z.infer<typeof nodeKindSchema>;
export const nodeAllocation: Record<NodeKind, AllocationClass> = {
  extractor: "semantic_triage",
  match_analyst: "semantic_triage",
  drafter: "packet_drafting",
  form_answer_planner: "form_questions",
  critic: "independent_critique",
  repair: "repairs",
};
export const graphBudgetSchema = z
  .object({
    steps: z.number().int().min(1).max(6),
    wallTimeMs: z.number().int().min(1).max(300000),
    tokens: z.number().int().min(1).max(32000),
    requests: z.number().int().min(0).max(6),
    nodeTokens: z.number().int().min(1).max(8000),
    nodeRequests: z.number().int().min(0).max(1),
  })
  .strict();
export type GraphRunBudget = z.infer<typeof graphBudgetSchema>;
const version = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/);
export const graphBindingSchema = z
  .object({
    graphVersion: version,
    promptVersion: version,
    schemaVersion: version,
    profileVersion: version,
    policyRevision: version,
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type GraphBinding = z.infer<typeof graphBindingSchema>;

// Pure proposal envelope: no permits, browser state, tools or application-state writes.
const fact = z
  .object({ id: version, revision: z.number().int().positive(), text: z.string().min(1).max(8000) })
  .strict();
const claim = z
  .object({ text: z.string().min(1).max(8000), factIds: z.array(version).min(1).max(30) })
  .strict();
const requirement = z
  .object({
    text: z.string().min(1).max(2000),
    start: z.number().int().min(0),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.end > value.start);
const input = z
  .object({
    jobId: version,
    description: z.string().min(1).max(200000),
    facts: z.array(fact).max(200),
    claims: z.array(claim).max(20),
    requirements: z.array(requirement).max(100),
  })
  .strict();
export const nodeInputSchema = z.object({ kind: nodeKindSchema, input }).strict();
export type NodeInput = z.infer<typeof nodeInputSchema>;
export const nodeOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("extractor"), requirements: z.array(requirement).max(100) }).strict(),
  z
    .object({
      kind: z.literal("match_analyst"),
      matches: z
        .array(
          z
            .object({
              requirementIndex: z.number().int().min(0).max(99),
              factIds: z.array(version).max(30),
            })
            .strict(),
        )
        .max(100),
    })
    .strict(),
  z.object({ kind: z.literal("drafter"), claims: z.array(claim).min(1).max(20) }).strict(),
  z
    .object({
      kind: z.literal("form_answer_planner"),
      proposals: z
        .array(z.object({ meaning: z.string().min(1).max(2000), claim }).strict())
        .max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("critic"),
      issues: z
        .array(
          z
            .object({
              claimIndex: z.number().int().min(0).max(19),
              code: z.enum(["unsupported_claim", "contradiction", "irrelevant", "format"]),
            })
            .strict(),
        )
        .max(100),
    })
    .strict(),
  z.object({ kind: z.literal("repair"), claims: z.array(claim).min(1).max(20) }).strict(),
]);
export type NodeOutput = z.infer<typeof nodeOutputSchema>;
