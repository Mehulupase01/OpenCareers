import { z } from "zod";

export const VERSION = "0.1.0";
export const idSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
export const applicationStateSchema = z.enum([
  "DISCOVERED",
  "NORMALIZED",
  "ASSESSED",
  "ELIGIBLE",
  "PREPARING",
  "PREPARED",
  "INSPECTING",
  "READY",
  "INTENT_RECORDED",
  "IN_FLIGHT",
  "CONFIRMED",
  "DEFINITIVE_FAILURE",
  "UNKNOWN",
  "RECONCILING",
  "NEEDS_REVIEW",
  "SKIPPED",
  "CLOSED",
  "DUPLICATE",
  "NEEDS_INPUT",
  "CHALLENGE_REQUIRED",
  "UNSUPPORTED",
  "PAUSED",
  "RETRY_WAIT",
  "HISTORICAL_SUBMITTED",
]);
export type ApplicationState = z.infer<typeof applicationStateSchema>;
export const taskTypeSchema = z.enum([
  "discover",
  "assess",
  "prepare",
  "inspect",
  "submit",
  "reconcile",
  "demo_probe",
]);
export type TaskType = z.infer<typeof taskTypeSchema>;
export const taskPayloadSchema = z.object({ schemaVersion: z.literal(1) }).catchall(z.unknown());
export const errorCodeSchema = z.enum([
  "CONFIG_INVALID",
  "STORAGE_UNAVAILABLE",
  "MIGRATION_UNSUPPORTED",
  "STATE_INVALID",
  "REVISION_STALE",
  "NOT_FOUND",
  "LEASE_STALE",
  "POLICY_REVOKED",
  "DUPLICATE_CONFIRMED",
  "DUPLICATE_SUSPECTED",
  "PROFILE_STALE",
  "JOB_CLOSED",
  "ANSWER_UNKNOWN",
  "FORM_CHANGED",
  "UPLOAD_FAILED",
  "CHALLENGE_REQUIRED",
  "SESSION_EXPIRED",
  "ADAPTER_UNSUPPORTED",
  "MODEL_QUOTA_EXHAUSTED",
  "MODEL_ROUTE_INELIGIBLE",
  "CLAIM_UNSUPPORTED",
  "COMMIT_UNKNOWN",
  "RECEIPT_UNCORRELATED",
  "UNAUTHORIZED",
  "ORIGIN_DENIED",
  "RATE_LIMITED",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const jobInputSchema = z
  .object({
    id: idSchema,
    employerId: idSchema,
    requisitionId: z.string().min(1).max(180),
    title: z.string().min(1).max(240),
    company: z.string().min(1).max(240),
    location: z.string().min(1).max(240),
    url: z.url().max(2000),
    description: z.string().max(100000),
    source: z.string().min(1).max(100),
    synthetic: z.boolean(),
  })
  .strict();
export type JobInput = z.infer<typeof jobInputSchema>;

export const controlSchema = z.object({
  discoveryPaused: z.boolean(),
  preparationPaused: z.boolean(),
  submissionsPaused: z.boolean(),
  stopped: z.boolean(),
  restoreBlocked: z.boolean(),
});
export type Control = z.infer<typeof controlSchema>;

export type Job = JobInput & { ownerId: string; createdAt: string; lastSeenAt: string };
export interface Application {
  id: string;
  ownerId: string;
  candidateId: string;
  jobId: string;
  state: ApplicationState;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface Task {
  id: string;
  ownerId: string;
  applicationId: string | null;
  type: TaskType;
  domain: string;
  state: "ready" | "leased" | "retry_wait" | "completed" | "cancelled" | "dead";
  payload: z.infer<typeof taskPayloadSchema>;
  fence: number;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  leaseUntil: string | null;
  leaseOwner: string | null;
  lastError: ErrorCode | null;
}
export interface WorkerStatus {
  id: string;
  kind: string;
  lastSeenAt: string;
  version: string;
}
export interface OperationsSummary {
  version: string;
  profile: "demo" | "local" | "server";
  control: Control;
  counts: {
    jobs: number;
    applications: number;
    confirmed: number;
    prepared: number;
    unknown: number;
    exceptions: number;
    pendingTasks: number;
  };
  workers: WorkerStatus[];
  applications: Application[];
  jobs: Job[];
  tasks: Task[];
  asOf: string;
}
