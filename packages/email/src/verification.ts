import { request } from "node:https";
import { isIP } from "node:net";
import { convert } from "html-to-text";
import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";
import { publicAddress, publicLookup } from "../../discovery/src/transport.js";
import { mailHash } from "./correlation.js";

export const verificationRuleSchema = z
  .object({
    employerOrigin: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.origin === value &&
        url.protocol === "https:" &&
        !url.port &&
        !url.username &&
        !url.password
      );
    }),
    pathname: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_-]{1,180}$/)
      .refine(
        (path) =>
          !/(?:apply|submit|application|password|reset|oauth)/i.test(path) && !path.includes("//"),
      ),
    queryKeys: z
      .array(z.enum(["token", "code", "key", "verification_token", "confirmation_token"]))
      .max(5)
      .refine((keys) => new Set(keys).size === keys.length),
    successMarker: z
      .string()
      .min(16)
      .max(240)
      .refine((value) => !/[<>\r\n]/.test(value)),
  })
  .strict();
export type VerificationRule = z.infer<typeof verificationRuleSchema>;
export const verificationDescriptorSchema = z
  .object({
    url: z.url().max(4096),
    accountId: z.string().min(1).max(180),
    signupAttemptId: z.string().min(1).max(180),
    identityEmailHash: z.string().regex(/^[a-f0-9]{64}$/),
    messageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    ruleHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type VerificationDescriptor = z.infer<typeof verificationDescriptorSchema>;
export function validateVerificationUrl(
  input: string,
  rawRule: VerificationRule,
  requireToken = false,
) {
  const rule = verificationRuleSchema.parse(rawRule);
  const url = new URL(input);
  const keys = [...url.searchParams.keys()];
  if (
    input.length > 4096 ||
    !input.startsWith(`${rule.employerOrigin}${rule.pathname}${keys.length ? "?" : ""}`) ||
    url.origin !== rule.employerOrigin ||
    url.pathname !== rule.pathname ||
    url.username ||
    url.password ||
    url.hash ||
    url.protocol !== "https:" ||
    url.port ||
    keys.length !== rule.queryKeys.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !rule.queryKeys.includes(key as VerificationRule["queryKeys"][number])) ||
    (requireToken && !keys.length) ||
    keys.some((key) => !/^[a-zA-Z0-9._~+/=-]{16,4096}$/.test(url.searchParams.get(key) ?? ""))
  )
    throw new DomainError(
      "ORIGIN_DENIED",
      "Verification destination differs from the reviewed signup route.",
    );
  return url;
}
export function selectVerificationLink(text: string, rules: VerificationRule[]) {
  const matches = new Map<string, { url: string; rule: VerificationRule }>();
  const candidates = [...text.matchAll(/https:\/\/[^\s<>"'[\]]+/g)];
  if (candidates.length > 10) return null;
  for (const match of candidates)
    for (const rule of rules) {
      try {
        const url = validateVerificationUrl(match[0].replace(/[.,;)]+$/, ""), rule, true);
        matches.set(url.href, { url: url.href, rule });
      } catch {
        /* Untrusted and unreviewed destinations never become proposals. */
      }
    }
  return matches.size === 1 ? ([...matches.values()][0] ?? null) : null;
}
export type VerificationRead = (
  url: string,
  signal: AbortSignal,
) => Promise<{ status: number; location: string | null; body: string }>;
export function verificationSucceeded(body: string, rule: VerificationRule) {
  return (
    Buffer.byteLength(body) <= 65536 &&
    convert(body, { wordwrap: false }).trim() === rule.successMarker.trim()
  );
}
export const readVerification: VerificationRead = async (input, signal) => {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    (isIP(hostname) && !publicAddress(hostname))
  )
    throw new DomainError("ORIGIN_DENIED", "Unapproved verification transport.");
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        lookup: publicLookup,
        agent: false,
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        headers: { Accept: "text/html,text/plain", "Accept-Encoding": "identity" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 65536) req.destroy();
          else chunks.push(chunk);
        });
        response.on("error", () =>
          reject(new DomainError("COMMIT_UNKNOWN", "Verification response was interrupted.")),
        );
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location:
              typeof response.headers.location === "string" ? response.headers.location : null,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", () =>
      reject(
        new DomainError(
          "COMMIT_UNKNOWN",
          "Verification response is uncertain; the link will not be replayed.",
        ),
      ),
    );
    req.end();
  });
};
export const verificationRuleHash = (rule: VerificationRule) =>
  mailHash(JSON.stringify(verificationRuleSchema.parse(rule)));
