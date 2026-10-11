import { z } from "zod";

export const scanReadSchema = z
  .object({
    ordinal: z.number().int().min(0).max(199),
    url: z.url().max(2000),
    requestEtag: z.string().max(1000).nullable(),
    revalidated: z.boolean(),
    response: z
      .object({
        status: z.union([z.literal(200), z.literal(302)]),
        body: z.string().max(8 * 1024 * 1024),
        etag: z.string().max(1000).nullable(),
        retryAfter: z.null(),
        location: z.string().max(2000).nullable(),
        fetchedAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();
export type ScanRead = z.infer<typeof scanReadSchema> & { verifiedAt: string };
