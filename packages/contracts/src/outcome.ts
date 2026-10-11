import { z } from "zod";
import { idSchema } from "./index.js";

export const outcomeKindSchema = z.enum([
  "RECEIVED",
  "SCREENING",
  "INTERVIEW",
  "REJECTION",
  "OFFER",
  "WITHDRAWN",
  "UNKNOWN",
]);
export type OutcomeKind = z.infer<typeof outcomeKindSchema>;
export const outcomeInputSchema = z
  .object({
    applicationId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    requestId: z.uuid(),
    kind: outcomeKindSchema,
    evidenceRef: idSchema,
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export interface OutcomeEvent {
  id: string;
  applicationId: string;
  revision: number;
  kind: OutcomeKind;
  source: "owner" | "email" | "reversal";
  actor: "owner" | "mail-correlator";
  evidenceRef: string;
  evidenceSha256: string;
  occurredAt: string;
  recordedAt: string;
  previousEventId: string | null;
}
export const cohortInputSchema = z
  .object({
    from: z.iso.datetime(),
    through: z.iso.datetime(),
    asOf: z.iso.datetime(),
    observationDays: z.number().int().min(1).max(365).default(30),
    minimumSample: z.number().int().min(20).max(1000).default(20),
  })
  .strict();
export interface CohortReport {
  status: "measured" | "insufficient_data";
  methodology: string;
  advisoryOnly: true;
  window: z.infer<typeof cohortInputSchema>;
  denominator: number;
  counts: Record<string, number>;
  exclusions: Record<string, number>;
  fractions: Record<string, { numerator: number; denominator: number; fraction: number }> | null;
}
