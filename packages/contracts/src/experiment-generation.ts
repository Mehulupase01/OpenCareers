import { z } from "zod";
import { idSchema } from "./index.js";
import { letterVariantRecipeSchema } from "./letter-variant.js";

export const experimentGenerationInputSchema = z
  .object({
    id: z.uuid(),
    experimentId: z.uuid(),
    variantId: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    applicationId: idSchema,
    assessmentId: idSchema,
    expectedApplicationRevision: z.number().int().positive(),
    expectedExperimentRevision: z.number().int().positive(),
    reviewed: z.literal(true),
  })
  .strict();
export const experimentGenerationTaskSchema = z
  .object({ schemaVersion: z.literal(1), generationId: z.uuid(), assessmentId: idSchema })
  .strict();
export const experimentGenerationViewSchema = experimentGenerationInputSchema
  .pick({ id: true, experimentId: true, variantId: true, applicationId: true, assessmentId: true })
  .extend({
    recipe: letterVariantRecipeSchema,
    state: z.enum(["queued", "drafting", "prepared", "failed", "assigned"]),
    packetId: idSchema.nullable(),
    packetSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    critiqueSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    repaired: z.boolean().nullable(),
    failureCode: z.string().max(100).nullable(),
    createdAt: z.iso.datetime(),
  });
export type ExperimentGenerationView = z.infer<typeof experimentGenerationViewSchema>;
