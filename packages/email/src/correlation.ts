import { createHash } from "node:crypto";
import {
  type MailClassification,
  type MailContext,
  type MailMessage,
  mailContextSchema,
  mailMessageSchema,
} from "../../contracts/src/email.js";

export const mailHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const recipientHash = (value: string) => mailHash(value.trim().toLowerCase());
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function classifyMail(message: MailMessage): MailClassification {
  const text = `${message.subject}\n${message.text}`;
  const labels: MailClassification[] = [];
  if (
    /\b(?:application (?:has been |was )?received|received your application|thank you for applying)\b/i.test(
      text,
    ) &&
    !/\b(?:not|never|haven't|have not|didn't|did not)\s+(?:yet\s+)?received\b|application (?:was |has )?not (?:been )?received/i.test(
      text,
    )
  )
    labels.push("application_received");
  if (/\b(?:verify|confirm) (?:your )?(?:email|email address|account)\b/i.test(text))
    labels.push("verification");
  if (/\b(?:account (?:has been |was )?created|welcome to your (?:new )?account)\b/i.test(text))
    labels.push("account_created");
  if (/\b(?:invite you to (?:an? )?interview|interview invitation)\b/i.test(text))
    labels.push("interview");
  if (
    /\b(?:not moving forward|will not (?:be )?(?:moving|proceed)|application (?:was |has been )?unsuccessful)\b/i.test(
      text,
    )
  )
    labels.push("rejection");
  if (labels.length === 2 && labels.includes("verification") && labels.includes("account_created"))
    return "verification";
  return labels.length === 1 ? (labels[0] ?? "ambiguous") : "ambiguous";
}

export function correlateMail(rawMessage: MailMessage, rawContexts: MailContext[]) {
  const message = mailMessageSchema.parse(rawMessage);
  const kind = classifyMail(message);
  const senderDomain = message.sender.toLowerCase().split("@")[1] ?? "";
  const text = `${message.subject}\n${message.text}`;
  const recipients = message.recipients.map((value) => value.toLowerCase());
  const receivedAt = Date.parse(message.receivedAt);
  const candidates = rawContexts
    .map((item) => mailContextSchema.parse(item))
    .filter((context) => {
      if (
        !recipients.includes(context.recipient.toLowerCase()) ||
        !context.senderDomains.includes(senderDomain) ||
        receivedAt < Date.parse(context.after) ||
        receivedAt > Date.parse(context.before)
      )
        return false;
      if (context.kind === "account") return ["verification", "account_created"].includes(kind);
      if (["verification", "account_created"].includes(kind)) return false;
      return (
        context.references.some((reference) =>
          new RegExp(
            `(?:^|[^a-zA-Z0-9_-])${escapePattern(reference)}(?:$|[^a-zA-Z0-9_-])`,
            "i",
          ).test(text),
        ) ||
        (context.role.length >= 5 && text.toLowerCase().includes(context.role.toLowerCase()))
      );
    });
  if (!candidates.length) return { status: "unrelated" as const, kind, context: null };
  const references = candidates.filter(
    (context) =>
      context.kind === "application" &&
      context.references.some((reference) =>
        new RegExp(`(?:^|[^a-zA-Z0-9_-])${escapePattern(reference)}(?:$|[^a-zA-Z0-9_-])`, "i").test(
          text,
        ),
      ),
  );
  const unique = references.length ? references : candidates;
  if (unique.length !== 1 || message.authenticatedDomain !== senderDomain || kind === "ambiguous")
    return { status: "ambiguous" as const, kind, context: null };
  if (kind === "application_received" && !references.length)
    return { status: "ambiguous" as const, kind, context: null };
  return { status: "correlated" as const, kind, context: unique[0] ?? null };
}
