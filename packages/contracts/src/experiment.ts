import { z } from "zod";
import { idSchema } from "./index.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const experimentInputSchema = z
  .object({
    id: z.uuid(),
    metric: z.enum(["SCREENING", "INTERVIEW", "OFFER"]),
    observationDays: z.number().int().min(1).max(365),
    expiresAt: z.iso.datetime(),
    maximumAssignments: z.number().int().min(2).max(10000),
    variants: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
            kind: z.enum(["wording", "ordering"]),
            approvalSha256: sha,
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict()
  .refine(
    (value) => new Set(value.variants.map((v) => v.id)).size === value.variants.length,
    "Variant identifiers must be distinct.",
  );
export const experimentAssignmentSchema = z
  .object({
    id: z.uuid(),
    experimentId: z.uuid(),
    variantId: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    applicationId: idSchema,
    packetId: idSchema,
    reviewedPacketSha256: sha,
    reviewed: z.literal(true),
  })
  .strict();
export const experimentStopSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
  })
  .strict();
