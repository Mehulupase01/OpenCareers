import { z } from "zod";
import { idSchema } from "./index.js";

export const monthSchema = z.string().regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/);
export const dateSchema = z.iso.date();
const text = z.string().trim().min(1).max(2000);
const period = { start: monthSchema, end: monthSchema.nullable() };
export const factValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("identity"),
      fullName: text,
      email: z.email(),
      phone: z.string().max(80),
      links: z.array(z.url()).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("employment"),
      employer: text,
      title: text,
      ...period,
      workload: z.enum(["full_time", "part_time"]),
      description: z.string().max(10000),
    })
    .strict(),
  z
    .object({ kind: z.literal("education"), institution: text, qualification: text, ...period })
    .strict(),
  z.object({ kind: z.literal("skill"), name: text, firstUsed: monthSchema.nullable() }).strict(),
  z
    .object({
      kind: z.literal("language"),
      name: text,
      level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native", "unspecified"]),
    })
    .strict(),
  z.object({ kind: z.literal("project"), name: text, description: text, ...period }).strict(),
  z
    .object({
      kind: z.literal("metric"),
      statement: text,
      value: z.number().finite(),
      unit: text,
      context: text,
    })
    .strict(),
  z
    .object({
      kind: z.literal("availability"),
      earliestDate: dateSchema.nullable(),
      noticeDays: z.number().int().min(0).max(730).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("work_authorization"),
      country: z.string().regex(/^[A-Z]{2}$/),
      currentlyAuthorized: z.enum(["yes", "no", "unknown"]),
      permitExpiresOn: dateSchema.nullable(),
      futureSponsorship: z.enum(["yes", "no", "unknown"]),
      approvedWording: z.string().max(2000),
    })
    .strict(),
]);
export type FactValue = z.infer<typeof factValueSchema>;
export const provenanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), sourceId: idSchema, locator: text, quote: text }).strict(),
  z.object({ kind: z.literal("owner"), statement: text }).strict(),
]);
export const factInputSchema = z
  .object({
    id: idSchema.optional(),
    expectedRevision: z.number().int().min(0),
    key: idSchema,
    value: factValueSchema,
    provenance: provenanceSchema,
    expiresOn: dateSchema.nullable(),
  })
  .strict();
export type FactInput = z.infer<typeof factInputSchema>;
export const factSchema = factInputSchema.omit({ expectedRevision: true }).extend({
  id: idSchema,
  revision: z.number().int().positive(),
  status: z.enum(["extracted", "owner_asserted", "verified", "conflicting", "expired"]),
  recordedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type CandidateFact = z.infer<typeof factSchema>;
export const sourceBlockSchema = z
  .object({
    locator: text,
    kind: z.enum(["paragraph", "table_cell", "page_line", "link"]),
    text: z.string().max(10000),
    url: z.url().nullable(),
    bounds: z.array(z.number().finite()).length(4).nullable(),
  })
  .strict();
export const extractionSchema = z
  .object({
    format: z.enum(["pdf", "docx"]),
    parserVersion: text,
    blocks: z.array(sourceBlockSchema).max(20000),
    warnings: z.array(text).max(200),
    quality: z.enum(["review_required", "unreadable"]),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;
export type SourceDocument = Extraction & {
  id: string;
  name: string;
  sha256: string;
  bytes: number;
  createdAt: string;
};
export type SourceSummary = Omit<SourceDocument, "blocks"> & { blockCount: number };
export const answerInputSchema = z
  .object({
    semanticKey: idSchema,
    meaning: text,
    answer: z.union([text, z.number().finite(), z.boolean()]),
    validFrom: dateSchema,
    validUntil: dateSchema,
    employerIds: z.array(idSchema).max(100),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(30),
    evidenceFactIds: z.array(idSchema).min(1).max(30),
  })
  .strict()
  .refine((v) => v.validUntil >= v.validFrom, "Answer validity interval is reversed.");
export type AnswerInput = z.infer<typeof answerInputSchema>;
export type ApprovedAnswer = AnswerInput & {
  id: string;
  revision: number;
  approvedAt: string;
  evidenceRevisions: Record<string, number>;
};
export const policyInputSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    mode: z.enum(["review_only", "fill_only", "auto_submit"]),
    profileVersionId: idSchema,
    roleTerms: z.array(z.string().trim().min(2).max(120)).min(1).max(50),
    countries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(30),
    blockedEmployerIds: z.array(idSchema).max(500),
    dailyLimit: z.number().int().min(1).max(200),
    allowAccountCreation: z.boolean(),
    allowOptionalDisclosures: z.boolean(),
    sponsorshipWording: z.string().max(2000).nullable(),
    salary: z
      .object({
        minimum: z.number().positive(),
        maximum: z.number().positive(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        period: z.enum(["year", "month", "hour"]),
      })
      .strict()
      .refine((v) => v.maximum >= v.minimum)
      .nullable(),
    salaryNegotiable: z.boolean().nullable(),
    effectiveAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    autoSubmitAcknowledged: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Date.parse(v.expiresAt) <= Date.parse(v.effectiveAt))
      ctx.addIssue({
        code: "custom",
        message: "Authorization expiry must follow its effective date.",
      });
    if (v.mode === "auto_submit" && !v.autoSubmitAcknowledged)
      ctx.addIssue({
        code: "custom",
        message: "Automatic final submission requires explicit standing authorization.",
      });
  });
export type PolicyInput = z.infer<typeof policyInputSchema>;
export type Authorization = PolicyInput & {
  id: string;
  revision: number;
  candidateId: string;
  revokedAt: string | null;
};
export interface ProfileSnapshot {
  id: string;
  revision: number;
  candidateId: string;
  facts: CandidateFact[];
  sha256: string;
  createdAt: string;
}
export interface CandidateSnapshot {
  candidateId: string;
  revision: number;
  facts: CandidateFact[];
  sources: SourceSummary[];
  profile: ProfileSnapshot | null;
  authorization: Authorization | null;
  answers: ApprovedAnswer[];
}
