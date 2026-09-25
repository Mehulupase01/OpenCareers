import { z } from "zod";

const fieldKind = z.enum([
  "text",
  "email",
  "tel",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "date",
  "file",
  "autocomplete",
  "unsupported",
]);

export const formFieldSchema = z
  .object({
    name: z.string().min(1).max(120),
    semanticKey: z.string().min(1).max(120),
    label: z.string().min(1).max(500),
    kind: fieldKind,
    required: z.boolean(),
    maxLength: z.number().int().positive().nullable(),
    options: z.array(z.object({ label: z.string(), value: z.string() }).strict()).max(100),
  })
  .strict();
export type FormField = z.infer<typeof formFieldSchema>;

export const formSnapshotSchema = z
  .object({
    url: z.url(),
    origin: z.url(),
    jobId: z.string().min(1).max(120),
    step: z.number().int().positive(),
    fields: z.array(formFieldSchema).max(100),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    blocker: z.enum(["none", "challenge", "login", "unsupported"]),
  })
  .strict();
export type FormSnapshot = z.infer<typeof formSnapshotSchema>;

export const fieldPlanSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            semanticKey: z.string().min(1).max(120),
            expected: z.union([z.string(), z.boolean()]),
            evidence: z.array(z.string()).max(30),
          })
          .strict(),
      )
      .max(100),
    unresolved: z.array(z.string()).max(100),
  })
  .strict();
export type FieldPlan = z.infer<typeof fieldPlanSchema>;

export const fillReportSchema = z
  .object({
    snapshot: formSnapshotSchema,
    status: z.enum(["ready", "needs_input", "challenge", "unsupported", "upload_failed"]),
    readBack: z.array(
      z
        .object({
          name: z.string(),
          expected: z.union([z.string(), z.boolean()]),
          actual: z.union([z.string(), z.boolean()]),
          matches: z.boolean(),
        })
        .strict(),
    ),
    uploadStatus: z.enum(["idle", "selected", "uploading", "accepted", "failed"]),
    issues: z.array(z.string()).max(100),
  })
  .strict();
export type FillReport = z.infer<typeof fillReportSchema>;

export const dryRunResultSchema = z
  .object({
    packetId: z.string().min(1).max(120),
    applicationId: z.string().min(1).max(120),
    status: z.enum(["ready", "needs_input", "challenge", "unsupported", "upload_failed"]),
    snapshots: z.array(formSnapshotSchema).min(1).max(5),
    plans: z.array(fieldPlanSchema).min(1).max(5),
    reports: z.array(fillReportSchema).min(1).max(5),
    issues: z.array(z.string()).max(100),
    blockedFinalActions: z.number().int().nonnegative(),
    serverApplicationCount: z.literal(0),
    preparedAt: z.iso.datetime(),
  })
  .strict();
export type DryRunResult = z.infer<typeof dryRunResultSchema>;

export const browserPreparationSchema = z
  .object({
    id: z.string().uuid(),
    status: dryRunResultSchema.shape.status,
    result: dryRunResultSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    resolvedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type BrowserPreparation = z.infer<typeof browserPreparationSchema>;
