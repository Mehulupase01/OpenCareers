import { z } from "zod";
import { type MailContext, mailContextSchema, mailIdSchema } from "../../contracts/src/email.js";
import { mailHash } from "./correlation.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pageToken = z.string().min(1).max(4000);
export const mailScanSchema = z
  .object({
    version: z.literal(1),
    entries: z
      .array(
        z
          .object({
            key: hash,
            before: z.iso.datetime(),
            pageToken: pageToken.nullable(),
            done: z.boolean(),
            seen: z.array(hash).max(8),
          })
          .strict(),
      )
      .max(50),
    nextIndex: z.number().int().min(0).max(49),
    pending: z
      .object({
        key: hash,
        ids: z.array(mailIdSchema).max(25),
        nextPageToken: pageToken.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((scan, context) => {
    if (
      new Set(scan.entries.map((entry) => entry.key)).size !== scan.entries.length ||
      (scan.entries.length && scan.nextIndex >= scan.entries.length) ||
      (scan.pending &&
        !scan.entries.some((entry) => entry.key === scan.pending?.key && !entry.done)) ||
      Buffer.byteLength(JSON.stringify(scan)) > 60000
    )
      context.addIssue({
        code: "custom",
        message: "Invalid or oversized mailbox scan checkpoint.",
      });
  });
export type MailScan = z.infer<typeof mailScanSchema>;
export function mailContextKey(context: MailContext) {
  const { before: _, ...identity } = mailContextSchema.parse(context);
  return mailHash(
    JSON.stringify({
      ...identity,
      senderDomains: [...identity.senderDomains].sort(),
      references: [...identity.references].sort(),
    }),
  );
}
export function newMailScan(contexts: MailContext[]): MailScan {
  return mailScanSchema.parse({
    version: 1,
    entries: [
      ...new Map(contexts.map((context) => [mailContextKey(context), context])).values(),
    ].map((context) => ({
      key: mailContextKey(context),
      before: context.before,
      pageToken: null,
      done: false,
      seen: [],
    })),
    nextIndex: 0,
    pending: null,
  });
}
