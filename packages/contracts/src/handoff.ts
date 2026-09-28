import { z } from "zod";

export const handoffStateSchema = z.enum([
  "open",
  "claimed",
  "rebuilding",
  "completed",
  "expired",
  "cancelled",
]);
export type HandoffState = z.infer<typeof handoffStateSchema>;

export const handoffSessionSchema = z
  .object({
    id: z.string().uuid(),
    applicationId: z.string().min(1).max(180),
    preparationId: z.string().uuid(),
    adapterId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    state: handoffStateSchema,
    generation: z.number().int().positive(),
    leaseUntil: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type HandoffSession = z.infer<typeof handoffSessionSchema>;
