import { z } from "zod";
import { idSchema } from "./index.js";
import { cohortInputSchema, outcomeKindSchema } from "./outcome.js";

export const submissionCohortMetadataSchema = z
  .object({
    method: z.literal("frozen_job_at_intent_v1"),
    jobId: idSchema,
    jobSha256: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().min(1).max(100),
    roleFamily: z.string().min(1).max(80),
    synthetic: z.boolean(),
  })
  .strict();
export type SubmissionCohortMetadata = z.infer<typeof submissionCohortMetadataSchema>;

export const cohortDimensionSchema = z.enum([
  "source",
  "roleFamily",
  "seniority",
  "sponsorship",
  "documentTemplate",
  "experimentVariant",
]);
export const cohortSnapshotInputSchema = cohortInputSchema
  .omit({ asOf: true })
  .extend({ id: z.uuid() })
  .strict();
export const cumulativeMilestoneSchema = z.enum(["SCREENING", "INTERVIEW", "OFFER"]);
export const cumulativeEvidenceSchema = z
  .object({
    historySha256: z.string().regex(/^[a-f0-9]{64}$/),
    milestones: z
      .array(
        z
          .object({
            kind: cumulativeMilestoneSchema,
            eventId: idSchema,
            revision: z.number().int().positive(),
            evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
            occurredAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export const fixedCohortSchema = z
  .object({
    id: z.uuid(),
    methodology: z.literal("fixed_current_outcome_at_observation_horizon_v1"),
    cumulativeMethodology: z.literal("corrected_observed_milestones_v1").optional(),
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
            metadataOrigin: z.literal("submission_intent").optional(),
            cumulativeEvidence: cumulativeEvidenceSchema.optional(),
            experiment: z
              .object({
                id: z.uuid(),
                variantId: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
                metric: z.enum(["SCREENING", "INTERVIEW", "OFFER"]),
                observationDays: z.number().int().min(1).max(365),
                definitionSha256: z.string().regex(/^[a-f0-9]{64}$/),
                assignmentSha256: z.string().regex(/^[a-f0-9]{64}$/),
                approvalSha256: z.string().regex(/^[a-f0-9]{64}$/),
                packetSha256: z.string().regex(/^[a-f0-9]{64}$/),
              })
              .strict()
              .optional(),
            groups: z
              .object({
                source: z.string().min(1).max(100),
                roleFamily: z.string().min(1).max(80),
                seniority: z.literal("unknown"),
                sponsorship: z.literal("unknown"),
                documentTemplate: z.string().min(1).max(100),
                experimentVariant: z.string().min(1).max(100).optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const [index, member] of snapshot.members.entries()) {
      const evidence = member.cumulativeEvidence;
      if (Boolean(snapshot.cumulativeMethodology) !== Boolean(evidence))
        context.addIssue({
          code: "custom",
          path: ["members", index, "cumulativeEvidence"],
          message: "Cumulative evidence and methodology must be present together.",
        });
      if (
        evidence &&
        (new Set(evidence.milestones.map((item) => item.kind)).size !==
          evidence.milestones.length ||
          new Set(evidence.milestones.map((item) => item.eventId)).size !==
            evidence.milestones.length ||
          new Set(evidence.milestones.map((item) => item.revision)).size !==
            evidence.milestones.length ||
          evidence.milestones.some(
            (item) =>
              Date.parse(item.occurredAt) > Date.parse(member.horizon) ||
              Date.parse(item.occurredAt) > Date.parse(snapshot.window.asOf),
          ))
      )
        context.addIssue({
          code: "custom",
          path: ["members", index, "cumulativeEvidence"],
          message: "Cumulative milestones must be unique and within the observation horizon.",
        });
    }
  });
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
