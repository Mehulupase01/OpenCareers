import { z } from "zod";

export const employerAccountStateSchema = z.enum([
  "prepared",
  "signup_in_flight",
  "active",
  "unknown",
  "needs_verification",
  "locked",
  "closed",
]);
export type EmployerAccountState = z.infer<typeof employerAccountStateSchema>;

export const employerAccountSchema = z
  .object({
    id: z.string().uuid(),
    candidateId: z.string().min(1).max(180),
    employerOrigin: z.url(),
    adapterId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    identityEmailHash: z.string().regex(/^[a-f0-9]{64}$/),
    state: employerAccountStateSchema,
    hasCredential: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type EmployerAccount = z.infer<typeof employerAccountSchema>;

export const signupReceiptEvidenceSchema = z
  .object({
    providerAccountId: z.string().min(1).max(180),
    employerOrigin: z.url(),
    adapterId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    identityEmailHash: z.string().regex(/^[a-f0-9]{64}$/),
    receivedAt: z.iso.datetime(),
  })
  .strict();
export type SignupReceiptEvidence = z.infer<typeof signupReceiptEvidenceSchema>;
