import { describe, expect, it } from "vitest";
import {
  GMAIL_READ_SCOPE,
  type MailContext,
  type MailMessage,
} from "../../packages/contracts/src/email.js";
import { classifyMail, correlateMail } from "../../packages/email/src/correlation.js";
import { GmailProvider, gmailQuery, parseGmailMessage } from "../../packages/email/src/gmail.js";

const context: MailContext = {
  id: "application-a",
  kind: "application",
  attemptId: "attempt-a",
  packetId: "packet-a",
  jobId: "job-a",
  recipient: "candidate@example.test",
  employerOrigin: "https://careers.example.test",
  senderDomains: ["careers.example.test"],
  role: "Software Engineer",
  references: ["REQ-123"],
  after: "2026-10-09T00:00:00.000Z",
  before: "2026-10-10T00:00:00.000Z",
};
const message: MailMessage = {
  id: "mail-a",
  receivedAt: "2026-10-09T12:00:00.000Z",
  sender: "recruiting@careers.example.test",
  recipients: [context.recipient],
  authenticatedDomain: "careers.example.test",
  subject: "Application received: REQ-123",
  text: "Thank you for applying for Software Engineer (REQ-123).",
};
const raw = (id = "mail-a") => ({
  id,
  internalDate: String(Date.parse(message.receivedAt)),
  payload: {
    mimeType: "text/plain",
    body: { data: Buffer.from(message.text).toString("base64url") },
    headers: [
      { name: "From", value: message.sender },
      { name: "To", value: context.recipient },
      { name: "Subject", value: message.subject },
      {
        name: "Authentication-Results",
        value: "mx.google.com; dkim=pass header.d=careers.example.test; spf=pass",
      },
    ],
  },
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("conservative mail correlation", () => {
  it("requires a uniquely bound vacancy reference and authenticated reviewed sender", () => {
    expect(correlateMail(message, [context])).toMatchObject({
      status: "correlated",
      kind: "application_received",
      context,
    });
    for (const altered of [
      { ...message, authenticatedDomain: null },
      { ...message, authenticatedDomain: "forged.example.test" },
      { ...message, subject: "Application received", text: "Software Engineer" },
    ])
      expect(correlateMail(altered, [context]).status).toBe("ambiguous");
  });
  it("rejects unrelated recipient, sender, time window, and reference substrings", () => {
    for (const altered of [
      { ...message, recipients: ["someone@example.test"] },
      { ...message, sender: "recruiting@unrelated.example.test" },
      { ...message, receivedAt: "2026-10-08T00:00:00.000Z" },
      { ...message, subject: "Application received REQ-1234", text: "" },
    ])
      expect(correlateMail(altered, [context]).status).toBe("unrelated");
  });
  it("does not confuse two applications to the same employer", () => {
    const other = {
      ...context,
      id: "application-b",
      attemptId: "attempt-b",
      references: ["REQ-456"],
    };
    expect(correlateMail(message, [context, other]).context?.id).toBe(context.id);
    expect(
      correlateMail({ ...message, text: "Thank you for applying REQ-123 and REQ-456" }, [
        context,
        other,
      ]).status,
    ).toBe("ambiguous");
    expect(
      correlateMail(message, [context, { ...other, references: context.references }]).status,
    ).toBe("ambiguous");
  });
  it("never treats account creation, verification, or mixed rejection as application receipt", () => {
    for (const text of [
      "Your account was created",
      "Confirm your email",
      "Application received but we are not moving forward",
      "We have not received your application",
    ]) {
      const mail = { ...message, subject: "REQ-123", text };
      expect(classifyMail(mail)).not.toBe("application_received");
      expect(correlateMail(mail, [context]).status).not.toBe("correlated");
    }
    expect(
      classifyMail({
        ...message,
        subject: "",
        text: "Your account was created. Verify your email.",
      }),
    ).toBe("verification");
  });
  it("bounds mailbox queries and never interpolates vacancy text", () => {
    const query = gmailQuery(context);
    expect(query).toContain('to:"candidate@example.test"');
    expect(query).not.toContain(context.role);
    expect(query).not.toContain("REQ-123");
    expect(() => gmailQuery({ ...context, after: "2026-09-01T00:00:00.000Z" })).toThrow(
      /fourteen days/,
    );
  });
});

describe("Gmail acquisition and OAuth", () => {
  it("uses provider receipt time and rejects duplicate Google authentication headers", () => {
    const envelope = raw();
    envelope.payload.headers.push({ name: "Date", value: "Tue, 01 Jan 2000 00:00:00 GMT" });
    expect(parseGmailMessage(envelope)).toEqual(message);
    envelope.payload.headers.push({
      name: "Authentication-Results",
      value: "mx.google.com; dkim=pass header.d=careers.example.test",
    });
    expect(parseGmailMessage(envelope)?.authenticatedDomain).toBeNull();
  });
  it("does not read attachments or accept multiple senders", () => {
    const envelope = raw();
    envelope.payload.mimeType = "application/pdf";
    expect(parseGmailMessage(envelope)?.text).toBe("");
    envelope.payload.headers.push({ name: "From", value: "forged@careers.example.test" });
    expect(parseGmailMessage(envelope)).toBeNull();
  });
  it("paginates narrow queries, deduplicates IDs and streams each observation", async () => {
    const calls: URL[] = [];
    const provider = new GmailProvider(async (input, init) => {
      const url = new URL(String(input));
      calls.push(url);
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-access-token");
      if (url.pathname.endsWith("/messages"))
        return json({
          messages: [{ id: url.searchParams.has("pageToken") ? "mail-b" : "mail-a" }],
          ...(url.searchParams.has("pageToken") ? {} : { nextPageToken: "next-page" }),
        });
      return json(raw(url.pathname.split("/").at(-1)));
    });
    const observed: string[] = [];
    let checks = 0;
    expect(
      await provider.messages(
        "synthetic-access-token",
        [context, context],
        async (mail) => {
          observed.push(mail.id);
        },
        async () => {
          checks++;
        },
      ),
    ).toEqual({ complete: true, inspected: 2 });
    expect(observed).toEqual(["mail-a", "mail-b"]);
    expect(calls.filter((url) => !url.pathname.endsWith("/messages"))).toHaveLength(2);
    expect(checks).toBe(6);
  });
  it("preserves observations before later request failure", async () => {
    const provider = new GmailProvider(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages"))
        return json({ messages: [{ id: "mail-a" }, { id: "mail-b" }] });
      if (url.pathname.endsWith("mail-b")) return json({}, 503);
      return json(raw());
    });
    const observed: string[] = [];
    await expect(
      provider.messages("synthetic-access-token", [context], async (mail) => {
        observed.push(mail.id);
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(observed).toEqual(["mail-a"]);
  });
  it("refuses repeating pagination tokens", async () => {
    const provider = new GmailProvider(async () => json({ nextPageToken: "same-page" }));
    await expect(
      provider.messages("synthetic-access-token", [context], async () => {}),
    ).rejects.toThrow(/did not advance/);
  });
  it("reports bounded partial scans instead of claiming exhaustive acquisition", async () => {
    let page = 0;
    const provider = new GmailProvider(async () => json({ nextPageToken: `page-${++page}` }));
    expect(await provider.messages("synthetic-access-token", [context], async () => {})).toEqual({
      complete: false,
      inspected: 0,
    });
    expect(page).toBe(50);
  });
  it("requires exact read-only scopes and never exposes remote error bodies", async () => {
    const client = { clientId: "synthetic-client-id", clientSecret: "synthetic-client-secret" };
    const tokens = {
      access_token: "synthetic-access-token",
      refresh_token: "synthetic-refresh-token",
      expires_in: 3600,
      scope: GMAIL_READ_SCOPE,
      token_type: "Bearer",
    };
    const provider = new GmailProvider(async (input) =>
      new URL(String(input)).pathname === "/token"
        ? json(tokens)
        : json({ emailAddress: context.recipient }),
    );
    const issued = await provider.exchange(
      client,
      { code: "synthetic-code" },
      null,
      true,
      new Date("2026-10-10T00:00:00.000Z"),
    );
    expect(issued.refreshExpiresAt).toBe("2026-10-17T00:00:00.000Z");
    const excessive = new GmailProvider(async () =>
      json({ ...tokens, scope: `${GMAIL_READ_SCOPE} https://mail.google.com/` }),
    );
    await expect(excessive.exchange(client, {}, null, false)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    const failed = new GmailProvider(async () =>
      json({ error: "private-token-never-display" }, 401),
    );
    await expect(failed.exchange(client, {}, null, false)).rejects.not.toThrow(/private-token/);
  });
});
