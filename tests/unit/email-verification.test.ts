import { describe, expect, it } from "vitest";
import { GMAIL_READ_SCOPE } from "../../packages/contracts/src/email.js";
import { GmailProvider, parseGmailMessage } from "../../packages/email/src/gmail.js";
import {
  readVerification,
  selectVerificationLink,
  validateVerificationUrl,
  verificationRuleSchema,
  verificationSucceeded,
} from "../../packages/email/src/verification.js";

const rule = verificationRuleSchema.parse({
  employerOrigin: "https://careers.synthetic.example",
  pathname: "/verify",
  queryKeys: ["token"],
  successMarker: "Your email address is verified.",
});
const url = `${rule.employerOrigin}/verify?token=synthetic-token-12345`;

describe("reviewed email verification routes", () => {
  it.each(["scope", "profile"])(
    "revokes an issued grant when %s validation fails",
    async (failure) => {
      const revoked: string[] = [];
      const provider = new GmailProvider(async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/token")
          return new Response(
            JSON.stringify({
              access_token: "synthetic-access-token",
              refresh_token: "synthetic-refresh-token",
              expires_in: 3600,
              token_type: "Bearer",
              scope: failure === "scope" ? "unexpected-scope" : GMAIL_READ_SCOPE,
            }),
          );
        if (url.pathname === "/revoke") {
          revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
          return new Response("");
        }
        return new Response(JSON.stringify({ emailAddress: "invalid-address" }));
      });
      await expect(
        provider.exchange(
          { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
          { grant_type: "authorization_code", code: "synthetic-code" },
          null,
          true,
        ),
      ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      expect(revoked).toEqual(["synthetic-refresh-token"]);
    },
  );
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]"])(
    "rejects literal non-public address %s before opening a socket",
    async (host) => {
      await expect(
        readVerification(`https://${host}/verify`, AbortSignal.timeout(1000)),
      ).rejects.toMatchObject({ code: "ORIGIN_DENIED" });
    },
  );
  it("accepts only the exact reviewed route and opaque token", () => {
    expect(validateVerificationUrl(url, rule, true).href).toBe(url);
    expect(selectVerificationLink(`Verify here: ${url}`, [rule])?.url).toBe(url);
  });
  it("extracts the reviewed link from a Gmail HTML-only message", () => {
    const message = parseGmailMessage({
      id: "synthetic-html-mail",
      internalDate: String(Date.parse("2026-10-10T12:00:00.000Z")),
      payload: {
        mimeType: "text/html",
        body: {
          data: Buffer.from(`<p><a href="${url}">Verify your email</a></p>`).toString("base64url"),
        },
        headers: [
          { name: "From", value: "accounts@careers.synthetic.example" },
          { name: "To", value: "candidate@example.test" },
          { name: "Subject", value: "Verify your email" },
          {
            name: "Authentication-Results",
            value: "mx.google.com; dkim=pass header.d=careers.synthetic.example",
          },
        ],
      },
    });
    expect(message).not.toBeNull();
    expect(selectVerificationLink(message?.text ?? "", [rule])?.url).toBe(url);
  });
  it.each([
    "http://careers.synthetic.example/verify?token=synthetic-token-12345",
    "https://other.synthetic.example/verify?token=synthetic-token-12345",
    "https://careers.synthetic.example.evil.test/verify?token=synthetic-token-12345",
    "https://careers.synthetic.example/other/../verify?token=synthetic-token-12345",
    "https://careers.synthetic.example/%76erify?token=synthetic-token-12345",
    "https://careers.synthetic.example/verify?token=synthetic-token-12345&token=synthetic-token-67890",
    "https://careers.synthetic.example/verify?token=synthetic-token-12345&next=https://evil.test",
    "https://careers.synthetic.example/verify?token=short",
    "https://careers.synthetic.example/verify?token=synthetic-token-12345#fragment",
    "https://user@careers.synthetic.example/verify?token=synthetic-token-12345",
    "https://careers.synthetic.example:444/verify?token=synthetic-token-12345",
  ])("denies unreviewed URL %s", (input) => {
    expect(() => validateVerificationUrl(input, rule, true)).toThrow();
    expect(selectVerificationLink(input, [rule])).toBeNull();
  });
  it("does not choose between distinct reviewed tokens", () => {
    expect(selectVerificationLink(`${url} ${url.replace("12345", "67890")}`, [rule])).toBeNull();
    expect(selectVerificationLink(`${url} ${url}`, [rule])?.url).toBe(url);
    expect(selectVerificationLink(Array(11).fill(url).join(" "), [rule])).toBeNull();
    expect(selectVerificationLink(`${url}${"a".repeat(4096)}`, [rule])).toBeNull();
  });
  it.each(["/apply", "/password-reset", "/oauth/callback", "/submit", "/verification//done"])(
    "refuses sensitive route %s",
    (pathname) => {
      expect(verificationRuleSchema.safeParse({ ...rule, pathname }).success).toBe(false);
    },
  );
  it("requires the complete reviewed success text, not a keyword or HTTP status", () => {
    expect(verificationSucceeded(rule.successMarker, rule)).toBe(true);
    expect(verificationSucceeded(`<main><p>${rule.successMarker}</p></main>`, rule)).toBe(true);
    expect(verificationSucceeded(`Not successful: ${rule.successMarker}`, rule)).toBe(false);
    expect(verificationSucceeded(`Your email address is not verified.`, rule)).toBe(false);
    expect(verificationSucceeded("x".repeat(65537), rule)).toBe(false);
  });
});
