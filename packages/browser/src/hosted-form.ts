import { createHash } from "node:crypto";
import type { Page, Route } from "playwright";
import {
  type FieldPlan,
  type FillReport,
  type FormField,
  type FormSnapshot,
  fillReportSchema,
  formSnapshotSchema,
} from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { planFields } from "./adapter.js";
import { assertGuardedPlan, type FormAnswerGuard } from "./answer-guard.js";
import { fillAndReadNativeControl } from "./form-controls.js";

export interface HostedFormTarget {
  url: string;
  jobId: string;
}
const aliases: Record<string, string> = {
  "full name": "full_name",
  "your full name": "full_name",
  "applicant name": "full_name",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  telephone: "phone",
  portfolio: "portfolio",
  "portfolio url": "portfolio",
};

export async function inspectHostedForm(
  page: Page,
  target: HostedFormTarget,
): Promise<FormSnapshot> {
  const expected = new URL(target.url);
  if (
    expected.protocol !== "https:" ||
    expected.port ||
    expected.username ||
    expected.password ||
    page.url() !== expected.href
  )
    throw new Error("Hosted form does not match its approved HTTPS vacancy URL.");
  const raw = await page.evaluate(() => {
    const forms = [...document.forms].filter(
      (form) => form.getClientRects().length > 0 && form.querySelector("input,textarea,select"),
    );
    if (forms.length !== 1) throw new Error("Hosted application form is missing or ambiguous.");
    const form = forms[0];
    if (!form) throw new Error("Hosted application form is missing.");
    const controls = [
      ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input,textarea,select",
      ),
    ].filter(
      (field) =>
        !(
          field instanceof HTMLInputElement &&
          ["hidden", "submit", "button", "reset"].includes(field.type)
        ),
    );
    const fields = controls.map((field, index) => {
      const referenced = field
        .getAttribute("aria-labelledby")
        ?.trim()
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const labels = [...(field.labels ?? [])].map((label) => {
        const copy = label.cloneNode(true) as HTMLElement;
        for (const nested of copy.querySelectorAll("input,textarea,select")) nested.remove();
        return copy.textContent ?? "";
      });
      const label = (referenced || field.getAttribute("aria-label") || labels.join(" "))
        .replace(/\s+/g, " ")
        .trim();
      const kind = field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase();
      return {
        name: `control_${index + 1}`,
        label: label || `Unlabeled control ${index + 1}`,
        kind,
        labelled: Boolean(label),
        visible: field.getClientRects().length > 0,
        disabled: field.matches(":disabled"),
        required: field.required || field.getAttribute("aria-required") === "true",
        maxLength:
          field instanceof HTMLSelectElement || field.maxLength <= 0 ? null : field.maxLength,
        domId: field.id,
        domName: field.name,
        constraints: {
          pattern: field.getAttribute("pattern"),
          minLength: field.getAttribute("minlength"),
          readOnly: field.hasAttribute("readonly"),
        },
        custom:
          field.hasAttribute("role") || (field instanceof HTMLInputElement && Boolean(field.list)),
      };
    });
    return {
      action: form.action,
      method: form.method,
      fields,
      custom: Boolean(
        form.querySelector(
          '[contenteditable="true"],[role="combobox"],[role="checkbox"],[role="radio"],[role="listbox"]',
        ),
      ),
      challenge: Boolean(
        document.querySelector(
          '[data-sitekey],.g-recaptcha,.h-captcha,iframe[src*="captcha"],iframe[src*="challenge"],script[src*="recaptcha"]',
        ),
      ),
      login: Boolean(form.querySelector('input[type="password"]')),
    };
  });
  const keys = new Set<string>();
  let unsupported =
    raw.custom ||
    raw.method !== "post" ||
    new URL(raw.action).origin !== expected.origin ||
    raw.fields.length === 0;
  const fields: FormField[] = raw.fields.map((field) => {
    const key = aliases[field.label.replace(/\s*\*\s*$/, "").toLowerCase()];
    const safe =
      field.labelled &&
      field.visible &&
      !field.disabled &&
      !field.constraints.readOnly &&
      !field.custom &&
      Boolean(key) &&
      ["text", "email", "tel"].includes(field.kind) &&
      (field.kind !== "email" || key === "email") &&
      (field.kind !== "tel" || key === "phone") &&
      !keys.has(key ?? "");
    if (!safe) unsupported = true;
    if (key) keys.add(key);
    return {
      name: field.name,
      semanticKey: key ?? field.name,
      label: field.label,
      kind: safe ? (field.kind as FormField["kind"]) : "unsupported",
      required: field.required,
      maxLength: field.maxLength,
      options: [],
    };
  });
  const structure = {
    target,
    action: raw.action,
    method: raw.method,
    controls: raw.fields,
    custom: raw.custom,
    fields,
  };
  return formSnapshotSchema.parse({
    url: expected.href,
    origin: expected.origin,
    jobId: target.jobId,
    step: 1,
    fields,
    fingerprint: createHash("sha256").update(JSON.stringify(structure)).digest("hex"),
    blocker: raw.challenge
      ? "challenge"
      : raw.login
        ? "login"
        : unsupported
          ? "unsupported"
          : "none",
  });
}

async function fillHostedFormGuarded(
  page: Page,
  target: HostedFormTarget,
  packet: PacketSnapshot,
  snapshot: FormSnapshot,
  plan: FieldPlan,
  guard: FormAnswerGuard,
): Promise<FillReport> {
  if (
    !packet.valid ||
    packet.manifest.validation.status === "blocked" ||
    packet.manifest.jobId !== target.jobId ||
    packet.content.job.url !== target.url
  )
    throw new Error("Packet is invalid or does not match the hosted vacancy.");
  const current = await inspectHostedForm(page, target);
  if (
    snapshot.blocker !== "none" ||
    current.blocker !== "none" ||
    snapshot.fingerprint !== current.fingerprint ||
    plan.fingerprint !== current.fingerprint
  )
    throw new Error("Hosted form is blocked or changed after inspection.");
  const expected = planFields(current, packet);
  if (
    plan.unresolved.length ||
    expected.unresolved.length ||
    JSON.stringify(plan) !== JSON.stringify(expected)
  )
    throw new Error("Hosted form plan is not the current packet-backed low-risk plan.");
  await assertGuardedPlan(guard, current, plan);
  const form = page.locator("form").filter({ visible: true });
  if ((await form.count()) !== 1) throw new Error("Hosted form changed.");
  const controls = form.locator(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]),textarea,select',
  );
  const readBack: FillReport["readBack"] = [];
  for (const entry of plan.entries) {
    const before = await inspectHostedForm(page, target);
    if (before.fingerprint !== current.fingerprint || before.blocker !== "none")
      throw new Error("Hosted form changed during filling.");
    await assertGuardedPlan(guard, before, plan);
    const index = current.fields.findIndex((field) => field.name === entry.name);
    const field = current.fields[index];
    if (!field) throw new Error("Hosted plan control disappeared.");
    const result = await fillAndReadNativeControl(controls.nth(index), field.kind, entry.expected);
    readBack.push({ name: entry.name, expected: entry.expected, ...result });
  }
  const after = await inspectHostedForm(page, target);
  const issues = readBack
    .filter((entry) => !entry.matches)
    .map((entry) => `Read-back mismatch: ${entry.name}`);
  if (after.fingerprint !== current.fingerprint || after.blocker !== "none")
    issues.push("Hosted form changed during filling.");
  for (const entry of readBack) {
    const index = current.fields.findIndex((field) => field.name === entry.name);
    entry.actual = await controls.nth(index).inputValue();
    const valid = await controls
      .nth(index)
      .evaluate((element) => element instanceof HTMLInputElement && element.validity.valid);
    entry.matches = entry.actual === entry.expected && valid;
    if (!entry.matches && !issues.includes(`Read-back mismatch: ${entry.name}`))
      issues.push(`Read-back mismatch: ${entry.name}`);
  }
  await assertGuardedPlan(guard, after, plan);
  // No submit/next clicks, file uploads or commit capability in this primitive.
  return fillReportSchema.parse({
    snapshot: current,
    status: issues.length ? "unsupported" : "ready",
    readBack,
    uploadStatus: "idle",
    issues,
  });
}

export async function fillHostedForm(
  page: Page,
  target: HostedFormTarget,
  packet: PacketSnapshot,
  snapshot: FormSnapshot,
  plan: FieldPlan,
  guard: FormAnswerGuard,
): Promise<FillReport> {
  let blocked = 0;
  // Generic low-risk filling never needs network activity, including GET side effects.
  const deny = async (route: Route) => {
    blocked++;
    await route.abort("blockedbyclient");
  };
  await page.route("**/*", deny);
  try {
    const report = await fillHostedFormGuarded(page, target, packet, snapshot, plan, guard);
    if (blocked)
      return {
        ...report,
        status: "unsupported",
        issues: [
          ...report.issues,
          "Hosted form attempted network activity during low-risk filling.",
        ],
      };
    return report;
  } finally {
    await page.unroute("**/*", deny);
  }
}
