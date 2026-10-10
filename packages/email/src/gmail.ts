import { convert } from "html-to-text";
import { z } from "zod";
import {
  GMAIL_READ_SCOPE,
  type MailContext,
  type MailMessage,
  mailContextSchema,
  mailIdSchema,
  mailMessageSchema,
} from "../../contracts/src/email.js";
import { DomainError } from "../../contracts/src/index.js";
import { mailHash } from "./correlation.js";
import { type MailScan, mailContextKey, mailScanSchema, newMailScan } from "./scan.js";

export const oauthClientSchema = z
  .object({ clientId: z.string().min(10).max(1000), clientSecret: z.string().min(5).max(1000) })
  .strict();
export type OAuthClient = z.infer<typeof oauthClientSchema>;
export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string | null;
  mailbox: string;
}
const tokenSchema = z
  .object({
    access_token: z.string().min(10).max(8192),
    refresh_token: z.string().min(10).max(8192).optional(),
    expires_in: z.number().int().min(1).max(86400),
    refresh_token_expires_in: z.number().int().positive().optional(),
    scope: z.string(),
    token_type: z.literal("Bearer"),
  })
  .passthrough();

async function boundedJson(response: Response) {
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500)
      throw new DomainError("RATE_LIMITED", "Gmail is temporarily unavailable; retry later.", true);
    throw new DomainError("SESSION_EXPIRED", "Gmail authorization requires reconnecting.");
  }
  if (!response.body) throw new DomainError("CONFIG_INVALID", "Gmail returned an empty response.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 256 * 1024) {
      await reader.cancel();
      throw new DomainError("CONFIG_INVALID", "Gmail response exceeded its limit.");
    }
    parts.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  } catch {
    throw new DomainError("CONFIG_INVALID", "Gmail returned invalid structured data.");
  }
}

export function gmailQuery(rawContext: MailContext) {
  const context = mailContextSchema.parse(rawContext);
  const after = Date.parse(context.after),
    before = Date.parse(context.before);
  if (!Number.isFinite(after) || before < after || before - after > 14 * 86400000)
    throw new DomainError("CONFIG_INVALID", "Gmail query window must be bounded to fourteen days.");
  // Never interpolate mailbox search operators from email or vacancy text.
  const quoted = (value: string) => `"${value.replace(/["\\]/g, "")}"`;
  return `to:${quoted(context.recipient)} {${context.senderDomains.map((domain) => `from:(@${domain})`).join(" ")}} after:${Math.floor(after / 1000)} before:${Math.ceil(before / 1000) + 1}`;
}

export class GmailProvider {
  constructor(private readonly request: typeof fetch = fetch) {}

  private call(url: string, init: RequestInit = {}) {
    const target = new URL(url);
    if (
      !new Set(["https://oauth2.googleapis.com", "https://gmail.googleapis.com"]).has(
        target.origin,
      ) ||
      target.username ||
      target.password
    )
      throw new DomainError("ORIGIN_DENIED", "Unapproved Gmail endpoint.");
    return this.request(target.href, {
      ...init,
      redirect: "error",
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    }).catch(() => {
      throw new DomainError("RATE_LIMITED", "Gmail request was interrupted.", true);
    });
  }

  async exchange(
    client: OAuthClient,
    parameters: Record<string, string>,
    existing: GmailTokens | null,
    testing: boolean,
    now = new Date(),
  ): Promise<GmailTokens> {
    const response = await this.call("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...parameters,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }),
    });
    const raw = await boundedJson(response);
    try {
      const parsed = tokenSchema.safeParse(raw);
      if (!parsed.success || parsed.data.scope.trim() !== GMAIL_READ_SCOPE)
        throw new DomainError(
          "SESSION_EXPIRED",
          "Gmail granted scopes differ from the reviewed read-only scope.",
        );
      const token = parsed.data;
      const refreshToken = token.refresh_token ?? existing?.refreshToken;
      if (!refreshToken)
        throw new DomainError("SESSION_EXPIRED", "Gmail did not grant offline access; reconnect.");
      const expiryCandidates = [
        token.refresh_token_expires_in
          ? now.getTime() + token.refresh_token_expires_in * 1000
          : null,
        existing?.refreshExpiresAt ? Date.parse(existing.refreshExpiresAt) : null,
        testing ? now.getTime() + 7 * 86400000 : null,
      ].filter((value): value is number => value !== null);
      const refreshExpiresAt = expiryCandidates.length
        ? new Date(Math.min(...expiryCandidates)).toISOString()
        : null;
      const tokens = {
        accessToken: token.access_token,
        refreshToken,
        expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
        refreshExpiresAt,
        mailbox: existing?.mailbox ?? "",
      };
      if (!existing) {
        const profile = z
          .object({ emailAddress: z.email() })
          .passthrough()
          .parse(await this.get("/profile?fields=emailAddress", tokens.accessToken));
        tokens.mailbox = profile.emailAddress.trim().toLowerCase();
      }
      return tokens;
    } catch {
      // A grant can exist even when validation or the mailbox lookup failed.
      if (raw && typeof raw === "object") {
        const grant = raw as Record<string, unknown>;
        const token = grant.refresh_token ?? grant.access_token;
        if (typeof token === "string" && token.length >= 10 && token.length <= 8192)
          await this.revoke(token).catch(() => undefined);
      }
      throw new DomainError(
        "SESSION_EXPIRED",
        "Gmail grant validation failed; reconnect from the mailbox workspace.",
      );
    }
  }

  async revoke(token: string) {
    const response = await this.call("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    if (!response.ok && response.status !== 400)
      throw new DomainError(
        "SESSION_EXPIRED",
        "Google revocation could not be verified; local access is disabled.",
      );
  }

  private async get(path: string, token: string, signal?: AbortSignal) {
    return boundedJson(
      await this.call(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
        ...(signal ? { signal } : {}),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      }),
    );
  }

  async messages(
    token: string,
    contexts: MailContext[],
    observe: (message: MailMessage) => Promise<void>,
    checkpoint: () => Promise<void> = async () => {},
    progress?: { scan: MailScan; save: (scan: MailScan) => Promise<void>; signal?: AbortSignal },
  ): Promise<{ complete: boolean; inspected: number }> {
    const signal = progress?.signal
      ? AbortSignal.any([progress.signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000);
    if (contexts.length > 50)
      throw new DomainError("CONFIG_INVALID", "Too many Gmail acquisition contexts.");
    const scan = mailScanSchema.parse(progress?.scan ?? newMailScan(contexts));
    const byKey = new Map(contexts.map((context) => [mailContextKey(context), context]));
    const save = async () => {
      mailScanSchema.parse(scan);
      await progress?.save(scan);
    };
    const ids = new Set<string>();
    let pages = 0;
    await save();
    while (scan.entries.some((entry) => !entry.done)) {
      const entry = scan.pending
        ? scan.entries.find((item) => item.key === scan.pending?.key)
        : scan.entries[scan.nextIndex];
      if (!entry) throw new DomainError("CONFIG_INVALID", "Mailbox checkpoint context is missing.");
      const context = byKey.get(entry.key);
      if (!context)
        throw new DomainError(
          "CONFIG_INVALID",
          "Mailbox checkpoint no longer matches its contexts.",
        );
      if (entry.done) {
        scan.nextIndex = (scan.nextIndex + 1) % scan.entries.length;
        continue;
      }
      if (!scan.pending) {
        if (++pages > 50 || ids.size >= 100) return { complete: false, inspected: ids.size };
        await checkpoint();
        const query = new URLSearchParams({
          q: gmailQuery({ ...context, before: entry.before }),
          maxResults: "25",
          includeSpamTrash: "false",
          fields: "messages/id,nextPageToken",
          ...(entry.pageToken ? { pageToken: entry.pageToken } : {}),
        });
        const list = z
          .object({
            messages: z
              .array(z.object({ id: mailIdSchema }).passthrough())
              .max(25)
              .optional(),
            nextPageToken: z.string().min(1).max(4000).optional(),
          })
          .passthrough()
          .parse(await this.get(`/messages?${query}`, token, signal));
        if (
          list.nextPageToken &&
          (list.nextPageToken === entry.pageToken ||
            entry.seen.includes(mailHash(list.nextPageToken)))
        )
          throw new DomainError("CONFIG_INVALID", "Gmail pagination did not advance.");
        scan.pending = {
          key: entry.key,
          ids: [...new Set((list.messages ?? []).map((message) => message.id))],
          nextPageToken: list.nextPageToken ?? null,
        };
        await save();
      }
      while (scan.pending.ids.length) {
        const id = scan.pending.ids[0];
        if (!id) break;
        if (ids.size >= 100) return { complete: false, inspected: ids.size };
        if (!ids.has(id)) {
          await checkpoint();
          const fields = new URLSearchParams({
            format: "full",
            fields: "id,internalDate,payload(headers,mimeType,body/data,parts)",
          });
          const message = parseGmailMessage(
            await this.get(`/messages/${encodeURIComponent(id)}?${fields}`, token, signal),
          );
          if (message?.id !== id)
            throw new DomainError(
              "CONFIG_INVALID",
              "Gmail returned a mismatched or invalid message.",
            );
          await observe(message);
          ids.add(id);
        }
        scan.pending.ids.shift();
        await save();
      }
      entry.pageToken = scan.pending.nextPageToken;
      entry.done = entry.pageToken === null;
      if (entry.pageToken) entry.seen = [...entry.seen, mailHash(entry.pageToken)].slice(-8);
      scan.pending = null;
      scan.nextIndex = (scan.entries.indexOf(entry) + 1) % scan.entries.length;
      await save();
    }
    return { complete: true, inspected: ids.size };
  }
}

export function parseGmailMessage(raw: unknown): MailMessage | null {
  const envelope = z
    .object({
      id: mailIdSchema,
      internalDate: z.string().regex(/^\d{10,16}$/),
      payload: z
        .object({
          headers: z
            .array(z.object({ name: z.string().max(120), value: z.string().max(8192) }))
            .max(100),
        })
        .passthrough(),
    })
    .passthrough()
    .safeParse(raw);
  if (!envelope.success) return null;
  const { id, internalDate, payload } = envelope.data;
  const headers = (name: string) =>
    payload.headers.filter((item) => item.name.toLowerCase() === name).map((item) => item.value);
  const addresses = (text: string) =>
    [...text.matchAll(/[A-Z0-9.!#$%&'*+/?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) =>
      match[0].toLowerCase(),
    );
  const senderAddresses = addresses(headers("from").join(","));
  if (senderAddresses.length !== 1 || headers("subject").length !== 1) return null;
  const authentication = headers("authentication-results").filter((value) =>
    /^mx\.google\.com\s*;/i.test(value),
  );
  const authenticatedDomain =
    authentication.length === 1
      ? (/\bdkim=pass\b[^;]*\bheader\.d=([a-z0-9.-]+)\b/i
          .exec(authentication[0] ?? "")?.[1]
          ?.toLowerCase() ?? null)
      : null;
  const plain: string[] = [],
    html: string[] = [];
  let count = 0;
  let incomplete = false;
  function visit(part: unknown, depth: number) {
    if (depth > 6 || ++count > 40) {
      incomplete = true;
      return;
    }
    if (!part || typeof part !== "object") return;
    const value = part as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
    if (
      typeof value.body?.data === "string" &&
      value.body.data.length > 48000 &&
      ["text/plain", "text/html"].includes(value.mimeType ?? "")
    )
      incomplete = true;
    if (
      typeof value.body?.data === "string" &&
      value.body.data.length <= 48000 &&
      ["text/plain", "text/html"].includes(value.mimeType ?? "")
    ) {
      const text = Buffer.from(value.body.data, "base64url").toString("utf8");
      if (value.mimeType === "text/plain") plain.push(text);
      else html.push(text);
    }
    if (Array.isArray(value.parts)) {
      if (value.parts.length > 40) incomplete = true;
      for (const child of value.parts.slice(0, 40)) visit(child, depth + 1);
    }
  }
  visit(payload, 0);
  const text = plain.length ? plain.join("\n") : convert(html.join("\n"), { wordwrap: false });
  if (incomplete || text.length > 32000) return null;
  const receivedAt = new Date(Number(internalDate));
  if (!Number.isFinite(receivedAt.getTime())) return null;
  const parsed = mailMessageSchema.safeParse({
    id,
    receivedAt: receivedAt.toISOString(),
    sender: senderAddresses[0],
    recipients: addresses([...headers("to"), ...headers("delivered-to")].join(",")),
    authenticatedDomain,
    subject: headers("subject")[0],
    text,
  });
  return parsed.success ? parsed.data : null;
}
