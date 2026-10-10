import { z } from "zod";

export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const mailIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/);
export const mailDomainSchema = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
export const mailMessageSchema = z
  .object({
    id: mailIdSchema,
    receivedAt: z.iso.datetime(),
    sender: z.email().max(320),
    recipients: z.array(z.email().max(320)).min(1).max(30),
    authenticatedDomain: mailDomainSchema.nullable(),
    subject: z.string().max(2000),
    text: z.string().max(32000),
  })
  .strict();
export type MailMessage = z.infer<typeof mailMessageSchema>;
export const mailContextSchema = z
  .object({
    id: z.string().min(1).max(180),
    kind: z.enum(["application", "account"]),
    attemptId: z.string().min(1).max(180),
    packetId: z.string().max(180).nullable(),
    jobId: z.string().max(180).nullable(),
    recipient: z.email().max(320),
    employerOrigin: z.url().max(2000),
    senderDomains: z.array(mailDomainSchema).min(1).max(10),
    role: z.string().max(240),
    references: z.array(z.string().min(3).max(180)).max(10),
    after: z.iso.datetime(),
    before: z.iso.datetime(),
  })
  .strict();
export type MailContext = z.infer<typeof mailContextSchema>;
export const mailClassificationSchema = z.enum([
  "application_received",
  "account_created",
  "verification",
  "interview",
  "rejection",
  "ambiguous",
]);
export type MailClassification = z.infer<typeof mailClassificationSchema>;
export interface MailConnectionSummary {
  state:
    | "unconfigured"
    | "disconnected"
    | "connecting"
    | "connected"
    | "refreshing"
    | "reconnect_required";
  generation: number;
  testing: boolean;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  lastSyncAt: string | null;
  reason: string;
  scanPaused: boolean;
}
export interface MailSnapshot {
  connection: MailConnectionSummary;
  messages: {
    id: string;
    kind: MailClassification;
    contextId: string | null;
    correlation: "correlated" | "ambiguous";
    receivedAt: string;
  }[];
  senderRules: { employerOrigin: string; senderDomain: string }[];
}
