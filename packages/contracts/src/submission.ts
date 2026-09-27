import { z } from "zod";

export const mockReceiptEvidenceSchema = z
  .object({
    kind: z.literal("mock_ats"),
    recordId: z.string().uuid(),
    jobId: z.string().min(1).max(120),
    receiptUrl: z.url(),
    receivedAt: z.iso.datetime(),
    emailHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type MockReceiptEvidence = z.infer<typeof mockReceiptEvidenceSchema>;

export const recruiteeReceiptEvidenceSchema = z
  .object({
    kind: z.literal("recruitee"),
    candidateId: z.number().int().positive(),
    tenant: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    offerSlug: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/),
    jobId: z.string().min(1).max(120),
    responseUrl: z.url(),
    receivedAt: z.iso.datetime(),
    emailHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type RecruiteeReceiptEvidence = z.infer<typeof recruiteeReceiptEvidenceSchema>;
