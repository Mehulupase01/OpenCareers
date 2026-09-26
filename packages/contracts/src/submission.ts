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
