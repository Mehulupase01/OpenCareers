import { z } from "zod";
import { idSchema } from "./index.js";

export const calibrationDatasetSchema = z
  .object({
    id: z.uuid(),
    from: z.iso.datetime(),
    through: z.iso.datetime(),
    labels: z
      .array(
        z
          .object({
            assessmentId: idSchema,
            relevant: z.boolean(),
            reviewedAt: z.iso.datetime(),
            evidenceRef: idSchema,
            evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.labels.map((item) => item.assessmentId)).size !== input.labels.length)
      context.addIssue({ code: "custom", message: "Assessment labels must be unique." });
  });
export const fixedCalibrationSchema = z
  .object({
    id: z.uuid(),
    from: z.iso.datetime(),
    through: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
    routeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    samples: z
      .array(
        z
          .object({
            assessmentId: idSchema,
            assessmentSha256: z.string().regex(/^[a-f0-9]{64}$/),
            jobId: idSchema,
            score: z.number().min(0).max(100),
            relevant: z.boolean(),
            synthetic: z.boolean(),
            reviewedAt: z.iso.datetime(),
            evidenceRef: idSchema,
            evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export type FixedCalibration = z.infer<typeof fixedCalibrationSchema>;
