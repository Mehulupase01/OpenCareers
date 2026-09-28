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
    // An account the employer created but still requires an emailed verification
    // for is a real account, not a confirmed usable one. Recording it explicitly
    // is what makes `needs_verification` reachable instead of a dead state.
    verificationRequired: z.boolean(),
  })
  .strict();
export type SignupReceiptEvidence = z.infer<typeof signupReceiptEvidenceSchema>;

export const accountPrepareInputSchema = z
  .object({
    candidateId: z.string().min(1).max(180),
    employerOrigin: z.url(),
    adapterId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    identityEmail: z.string().max(320),
  })
  .strict();
export type AccountPrepareInput = z.infer<typeof accountPrepareInputSchema>;

export const accountSignupInputSchema = z
  .object({
    identityEmail: z.string().max(320),
  })
  .strict();
export type AccountSignupInput = z.infer<typeof accountSignupInputSchema>;
