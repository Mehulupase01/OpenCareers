import { z } from "zod";
import { browserSessionSchema } from "./browser-session.js";

export const sourceSessionInputSchema = z
  .object({
    sourceId: z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/),
    adapterId: z.string().regex(/^[a-z][a-z0-9_-]{1,99}$/),
    expectedRevision: z.number().int().min(0),
    ownedAccount: z.literal(true),
    permissionEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime(),
    session: browserSessionSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const url = new URL(input.session.origin);
    if (
      url.origin !== input.session.origin ||
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      !/[a-z]/i.test(url.hostname) ||
      url.hostname === "localhost" ||
      !url.hostname.includes(".")
    )
      context.addIssue({
        code: "custom",
        path: ["session", "origin"],
        message: "An exact HTTPS source origin is required.",
      });
    const identities = new Set<string>();
    for (const cookie of input.session.cookies) {
      const domain = cookie.domain.replace(/^\./, "");
      const identity = JSON.stringify([cookie.name, domain, cookie.path]);
      if (
        domain !== url.hostname ||
        !cookie.secure ||
        identities.has(identity) ||
        /(?:captcha|cf_clearance|__cf_bm|__cfseq|datadome|^_px)/i.test(cookie.name)
      )
        context.addIssue({
          code: "custom",
          path: ["session", "cookies"],
          message:
            "Cookies must be unique, secure and exact-host scoped; challenge state is unsupported.",
        });
      identities.add(identity);
    }
    if (
      !input.session.cookies.length ||
      new TextEncoder().encode(JSON.stringify(input.session)).byteLength > 60000
    )
      context.addIssue({
        code: "custom",
        path: ["session"],
        message: "A bounded, nonempty source session is required.",
      });
  });
export type SourceSessionInput = z.infer<typeof sourceSessionInputSchema>;
export interface SourceSessionSummary {
  sourceId: string;
  adapterId: string;
  origin: string;
  revision: number;
  state: "stored" | "expired" | "revoked";
  expiresAt: string;
  updatedAt: string;
}
