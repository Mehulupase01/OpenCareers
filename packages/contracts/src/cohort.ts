import { z } from "zod";
import { idSchema } from "./index.js";
import { cohortInputSchema, outcomeKindSchema } from "./outcome.js";

export const cohortDimensionSchema = z.enum([
  "source",
  "roleFamily",
  "seniority",
  "sponsorship",
  "documentTemplate",
]);
export const cohortSnapshotInputSchema = cohortInputSchema
  .omit({ asOf: true })
  .extend({ id: z.uuid() })
  .strict();
export const fixedCohortSchema = z
  .object({
    id: z.uuid(),
    methodology: z.literal("fixed_current_outcome_at_observation_horizon_v1"),
    window: cohortInputSchema,
    recordedAt: z.iso.datetime(),
    exclusions: z.record(z.string(), z.number().int().nonnegative()),
    members: z
      .array(
        z
          .object({
            applicationId: idSchema,
            jobId: idSchema,
            receiptId: idSchema,
            receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
            receivedAt: z.iso.datetime(),
            horizon: z.iso.datetime(),
            outcome: outcomeKindSchema,
            outcomeEventId: idSchema.nullable(),
            outcomeEvidenceSha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            metadataSha256: z.string().regex(/^[a-f0-9]{64}$/),
            groups: z
              .object({
                source: z.string().min(1).max(100),
                roleFamily: z.string().min(1).max(80),
                seniority: z.literal("unknown"),
                sponsorship: z.literal("unknown"),
                documentTemplate: z.string().min(1).max(100),
              })
              .strict(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export const cohortComparisonInputSchema = z
  .object({
    leftSnapshotId: z.uuid(),
    rightSnapshotId: z.uuid(),
    dimension: cohortDimensionSchema,
    leftValue: z.string().min(1).max(100),
    rightValue: z.string().min(1).max(100),
  })
  .strict();
export type FixedCohort = z.infer<typeof fixedCohortSchema>;
export type CohortDimension = z.infer<typeof cohortDimensionSchema>;
