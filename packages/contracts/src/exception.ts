import { z } from "zod";
import { errorCodeSchema, idSchema } from "./index.js";

export const exceptionBlockerSchema = z.enum([
  "answer_unknown",
  "challenge_required",
  "needs_review",
  "needs_input",
  "unsupported_form",
  "task_failed",
  "account_blocked",
]);
export type ExceptionBlocker = z.infer<typeof exceptionBlockerSchema>;

export const exceptionActionSchema = z.enum([
  "resolve_answer",
  "open_session",
  "rebuild_form",
  "reconcile",
  "defer",
  "skip",
  "retry",
]);
export type ExceptionAction = z.infer<typeof exceptionActionSchema>;

/**
 * A hint is only offered when an approved, in-scope answer already exists for
 * the exact meaning of this question. It is a proposal the owner confirms; the
 * value is never filled in automatically.
 */
export const exceptionSuggestionSchema = z
  .object({
    semanticKey: z.string().min(1).max(120),
    answerId: idSchema,
    answer: z.union([z.string(), z.number(), z.boolean()]),
    approvedAt: z.iso.datetime(),
  })
  .strict();
export type ExceptionSuggestion = z.infer<typeof exceptionSuggestionSchema>;

export const ownerExceptionSchema = z
  .object({
    id: idSchema,
    blocker: exceptionBlockerSchema,
    code: errorCodeSchema,
    reason: z.string().min(1).max(240),
    applicationId: idSchema.nullable(),
    job: z
      .object({
        id: idSchema,
        title: z.string().max(240),
        company: z.string().max(240),
        employerId: idSchema,
        countryCode: z.string().max(2).optional(),
      })
      .strict()
      .nullable(),
    question: z
      .object({
        semanticKey: z.string().min(1).max(120),
        meaning: z.string().min(1).max(400),
        answered: z.boolean(),
        resolvedAnswerId: idSchema.nullable(),
      })
      .strict()
      .nullable(),
    suggestedAnswer: exceptionSuggestionSchema.nullable(),
    actions: z.array(exceptionActionSchema).min(1),
    state: z.enum(["open", "deferred", "resolved"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((item) => (item.applicationId === null) === (item.job === null), {
    message: "Application and job context must be present together.",
  });
export type OwnerException = z.infer<typeof ownerExceptionSchema>;

export const exceptionResolveInputSchema = z
  .object({
    action: exceptionActionSchema,
    // `resolve_answer` requires the owner to supply the wording and the facts
    // that support it. The system will never invent an answer to an unknown
    // question, and it will never approve an unsupported one.
    answer: z.union([z.string().max(2000), z.number().finite(), z.boolean()]).optional(),
    factIds: z.array(idSchema).min(1).max(30).optional(),
    meaning: z.string().min(1).max(400).optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action !== "resolve_answer") return;
    if (input.answer === undefined)
      context.addIssue({
        code: "custom",
        path: ["answer"],
        message: "Resolving a question requires the owner's approved answer.",
      });
    if (!input.factIds || input.factIds.length === 0)
      context.addIssue({
        code: "custom",
        path: ["factIds"],
        message: "An approved answer must cite the facts that support it.",
      });
  });
export type ExceptionResolveInput = z.infer<typeof exceptionResolveInputSchema>;

export const exceptionResolvedSchema = z
  .object({
    exception: ownerExceptionSchema,
    requeued: z.number().int().min(0),
    // `open_session` returns the one-time handoff token exactly once. It is never
    // stored in plaintext and never returned again.
    handoff: z
      .object({ sessionId: idSchema, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .nullable(),
  })
  .strict();
export type ExceptionResolved = z.infer<typeof exceptionResolvedSchema>;
