import { z } from "zod";
import { dateSchema, factValueSchema, monthSchema } from "./candidate.js";
import { idSchema } from "./index.js";

const text = z.string().trim().min(1).max(8000);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const factReferenceSchema = z
  .object({ factId: idSchema, revision: z.number().int().positive() })
  .strict();
export type FactReference = z.infer<typeof factReferenceSchema>;

export const documentClaimSchema = z
  .object({
    id: idSchema,
    kind: z.enum([
      "identity",
      "summary",
      "employment",
      "education",
      "skill",
      "language",
      "project",
      "metric",
      "availability",
      "authorization",
      "experience_total",
    ]),
    text,
    evidence: z.array(factReferenceSchema).min(1).max(30),
    origin: z.enum(["deterministic", "inference_validated"]),
    deliveryStatus: z
      .enum(["researched", "prototyped", "built", "deployed", "maintained", "developing"])
      .nullable(),
  })
  .strict();
export type DocumentClaim = z.infer<typeof documentClaimSchema>;

const identitySchema = z
  .object({
    fullName: text.max(240),
    email: z.email(),
    phone: z.string().max(80),
    links: z.array(z.url()).max(20),
    evidence: z.array(factReferenceSchema).min(1).max(5),
  })
  .strict();

export const cvDocumentSchema = z
  .object({
    kind: z.literal("cv"),
    templateVersion: z.literal("cv-v1"),
    identity: identitySchema,
    summary: documentClaimSchema,
    employment: z
      .array(
        z
          .object({
            factId: idSchema,
            revision: z.number().int().positive(),
            employer: text.max(240),
            title: text.max(240),
            start: monthSchema,
            end: monthSchema.nullable(),
            workload: z.enum(["full_time", "part_time"]),
            bullets: z.array(documentClaimSchema).max(8),
          })
          .strict(),
      )
      .max(40),
    education: z
      .array(
        z
          .object({
            factId: idSchema,
            revision: z.number().int().positive(),
            institution: text.max(240),
            qualification: text.max(400),
            start: monthSchema,
            end: monthSchema.nullable(),
          })
          .strict(),
      )
      .max(20),
    skills: z.array(documentClaimSchema).max(80),
    languages: z.array(documentClaimSchema).max(30),
    projects: z.array(documentClaimSchema).max(12),
    experience: z
      .object({ professional: documentClaimSchema, handsOn: documentClaimSchema })
      .strict(),
  })
  .strict();
export type CvDocument = z.infer<typeof cvDocumentSchema>;

export const letterDocumentSchema = z
  .object({
    kind: z.literal("motivation_letter"),
    templateVersion: z.literal("letter-v1"),
    company: text.max(240),
    role: text.max(240),
    salutation: text.max(240),
    opening: text,
    contributions: z.array(documentClaimSchema).min(1).max(3),
    motivation: text,
    practical: documentClaimSchema.nullable(),
    closing: text.max(1000),
  })
  .strict();
export type LetterDocument = z.infer<typeof letterDocumentSchema>;

export const answerProposalSchema = z
  .object({
    semanticKey: idSchema,
    meaning: text.max(2000),
    answer: z.union([text, z.number().finite(), z.boolean()]).nullable(),
    status: z.enum(["approved_reuse", "deterministic", "deferred"]),
    maxCharacters: z.number().int().positive().max(100000).nullable(),
    evidence: z.array(factReferenceSchema).max(30),
    approvedAnswerId: idSchema.nullable(),
    approvedAnswerRevision: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "deferred" && value.answer !== null)
      ctx.addIssue({ code: "custom", message: "Deferred answers cannot contain guessed text." });
    if (value.status !== "deferred" && value.answer === null)
      ctx.addIssue({ code: "custom", message: "Resolved answers require a value." });
    if (
      value.maxCharacters &&
      typeof value.answer === "string" &&
      value.answer.length > value.maxCharacters
    )
      ctx.addIssue({ code: "custom", message: "Answer exceeds its character limit." });
  });
export type AnswerProposal = z.infer<typeof answerProposalSchema>;

export const packetContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    job: z
      .object({ id: idSchema, company: text.max(240), role: text.max(240), url: z.url() })
      .strict(),
    profileId: idSchema,
    profileRevision: z.number().int().positive(),
    assessmentId: idSchema,
    generatedAt: z.iso.datetime(),
    cv: cvDocumentSchema,
    letter: letterDocumentSchema,
    answers: z.array(answerProposalSchema).max(100),
    changeSummary: z
      .object({
        reorderedSkills: z.array(text.max(240)).max(80),
        selectedEvidence: z.array(text).max(100),
        excludedEvidence: z.array(text).max(100),
        summaryChanges: z.array(text).max(20),
      })
      .strict(),
  })
  .strict();
export type PacketContent = z.infer<typeof packetContentSchema>;

export const validationIssueSchema = z
  .object({
    code: z.enum([
      "EVIDENCE_MISSING",
      "EVIDENCE_STALE",
      "CLAIM_UNSUPPORTED",
      "DELIVERY_UPGRADED",
      "EXPERIENCE_CONFLATED",
      "VACANCY_MISMATCH",
      "EMPLOYER_LEAK",
      "PLACEHOLDER_PRESENT",
      "ANSWER_DEFERRED",
      "ANSWER_TOO_LONG",
      "FORMAT_INVALID",
      "CONTENT_MISMATCH",
      "LAYOUT_INVALID",
      "UPLOAD_TOO_LARGE",
    ]),
    severity: z.enum(["error", "warning"]),
    path: z.string().max(500),
    message: text,
  })
  .strict();
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const validationReportSchema = z
  .object({
    validatorVersion: z.literal("packet-validator-v1"),
    status: z.enum(["valid", "blocked", "needs_input"]),
    issues: z.array(validationIssueSchema).max(500),
    checkedClaimIds: z.array(idSchema).max(1000),
    checkedAt: z.iso.datetime(),
  })
  .strict();
export type ValidationReport = z.infer<typeof validationReportSchema>;

export const artifactSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["cv_docx", "cv_pdf", "letter_docx", "letter_pdf", "answers_json"]),
    sha256: sha256Schema,
    mimeType: z.enum([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
      "application/json",
    ]),
    bytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    storageKey: z.string().regex(/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/),
    filename: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/),
  })
  .strict();
export type PacketArtifact = z.infer<typeof artifactSchema>;

export const packetManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    applicationId: idSchema,
    jobId: idSchema,
    profileId: idSchema,
    profileRevision: z.number().int().positive(),
    assessmentId: idSchema,
    authorizationId: idSchema,
    authorizationRevision: z.number().int().positive(),
    contentSha256: sha256Schema,
    templateVersions: z.object({ cv: z.literal("cv-v1"), letter: z.literal("letter-v1") }).strict(),
    artifacts: z.array(artifactSchema).length(5),
    validation: validationReportSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PacketManifest = z.infer<typeof packetManifestSchema>;

export interface PacketSnapshot {
  manifest: PacketManifest;
  content: PacketContent;
  valid: boolean;
  invalidReason: string | null;
}

export const privateArtifactFactSchema = factValueSchema;
export const packetRequestedAnswerSchema = z
  .object({
    semanticKey: idSchema,
    meaning: text.max(2000),
    maxCharacters: z.number().int().positive().max(100000).nullable(),
    country: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict();
export type PacketRequestedAnswer = z.infer<typeof packetRequestedAnswerSchema>;

export const packetGenerateInputSchema = z
  .object({
    applicationId: idSchema,
    assessmentId: idSchema,
    requestedAnswers: z.array(packetRequestedAnswerSchema).max(100).default([]),
    asOf: dateSchema,
  })
  .strict();
export type PacketGenerateInput = z.infer<typeof packetGenerateInputSchema>;
