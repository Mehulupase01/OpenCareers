import { z } from "zod";

export const browserSessionSchema = z
  .object({
    origin: z.url(),
    cookies: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            value: z.string().max(8192),
            domain: z.string().min(1).max(253),
            path: z.string().startsWith("/").max(2048),
            expires: z.number().finite(),
            httpOnly: z.boolean(),
            secure: z.boolean(),
            sameSite: z.enum(["Strict", "Lax", "None"]),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type BrowserSessionState = z.infer<typeof browserSessionSchema>;
