import { z } from "zod";

export const hostedOriginSchema = z
  .url()
  .max(500)
  .refine((raw) => {
    try {
      const url = new URL(raw);
      return (
        url.protocol === "https:" &&
        url.origin === raw &&
        !url.port &&
        !url.username &&
        !url.password &&
        /^[a-z0-9][a-z0-9.-]*$/i.test(url.hostname) &&
        !/^[\d.]+$/.test(url.hostname) &&
        !/(^|\.)(localhost|local|internal)$/.test(url.hostname)
      );
    } catch {
      return false;
    }
  }, "An exact public HTTPS hostname origin is required.");

export const hostedOriginApprovalSchema = z
  .object({
    origin: hostedOriginSchema,
    expectedRevision: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime(),
    publicReadAndLowRiskFillReviewed: z.literal(true),
  })
  .strict();
export const hostedOriginRevocationSchema = hostedOriginApprovalSchema.pick({
  origin: true,
  expectedRevision: true,
});
export const hostedOriginPermissionSchema = z
  .object({
    origin: hostedOriginSchema,
    revision: z.number().int().positive(),
    state: z.enum(["active", "revoked"]),
    expiresAt: z.iso.datetime(),
    permissionSha256: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type HostedOriginPermission = z.infer<typeof hostedOriginPermissionSchema>;
