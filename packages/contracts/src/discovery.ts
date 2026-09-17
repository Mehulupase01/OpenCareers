import { z } from "zod";
import { idSchema, jobInputSchema } from "./index.js";

export const sourceInputSchema = z
  .object({
    id: idSchema.optional(),
    expectedRevision: z.number().int().min(0),
    connector: z.enum(["greenhouse", "lever"]),
    board: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    region: z.enum(["global", "eu"]),
    employerId: idSchema,
    company: z.string().trim().min(1).max(240),
    intervalSeconds: z.number().int().min(300).max(86400),
    enabled: z.boolean(),
    mode: z.enum(["fixture", "live"]),
  })
  .strict();
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type SourceHealth =
  | "waiting"
  | "healthy"
  | "quality_warning"
  | "parser_failed"
  | "unavailable"
  | "rate_limited"
  | "forbidden";
export interface DiscoverySource extends SourceInput {
  id: string;
  revision: number;
  health: SourceHealth;
  nextPollAt: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  count: number;
  failures: number;
  etag: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
}
export const normalizedJobSchema = jobInputSchema
  .extend({
    postingId: z.string().min(1).max(180),
    providerRequisition: z.string().max(180).nullable(),
    canonicalUrl: z.url(),
    city: z.string().max(240).nullable(),
    remote: z.enum(["remote", "hybrid", "on_site", "unknown"]),
    postedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime().nullable(),
    roleFamily: z.string().max(80).nullable(),
    evidence: z.object({ page: z.number().int().min(0), locator: z.string().max(240) }).strict(),
  })
  .strict();
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;
export interface SourcePage {
  url: string;
  status: number;
  body: string;
  sha256: string;
  etag: string | null;
  fetchedAt: string;
}
export type SourcePageEvidence = Omit<SourcePage, "body">;
export interface DiscoveryBatch {
  jobs: NormalizedJob[];
  pages: SourcePage[];
  notModified: boolean;
  warnings: string[];
  etag: string | null;
}
export interface SourceRun {
  id: string;
  sourceId: string;
  startedAt: string;
  completedAt: string;
  health: SourceHealth;
  count: number;
  durationMs: number;
  warnings: string[];
}
export interface DiscoveryListing {
  id: string;
  sourceId: string;
  jobId: string;
  originalJobId: string;
  job: NormalizedJob;
  state: "open" | "missing" | "closed";
  firstSeenAt: string;
  lastSeenAt: string;
  missingSince: string | null;
  lastRunId: string;
}
export const historyRecordSchema = z
  .object({
    externalId: z.string().trim().min(1).max(180),
    url: z.url().max(2000),
    company: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(240),
    location: z.string().max(240).default("Unknown"),
    submitted: z.boolean(),
    submittedOn: z.iso.date().nullable(),
    ownerAssertion: z.string().trim().max(2000),
    documents: z
      .array(
        z
          .object({
            name: z.string().min(1).max(240),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .refine(
    (r) => !r.submitted || (r.submittedOn && r.ownerAssertion),
    "Submitted history needs an explicit dated owner assertion.",
  );
export type HistoryRecord = z.infer<typeof historyRecordSchema>;
export interface DiscoverySnapshot {
  sources: DiscoverySource[];
  listings: DiscoveryListing[];
  runs: SourceRun[];
  listingCount: number;
  resolutions: Array<{
    id: string;
    from: string;
    to: string;
    reason: string;
    reversedAt: string | null;
  }>;
  history: Array<HistoryRecord & { id: string; jobId: string | null; importedAt: string }>;
}
