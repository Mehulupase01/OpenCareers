import { createHash } from "node:crypto";
import type { Page } from "playwright";
import {
  type FieldPlan,
  type FillReport,
  type FormField,
  type FormSnapshot,
  fieldPlanSchema,
  fillReportSchema,
  formSnapshotSchema,
} from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const selector = (name: string) => {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/.test(name))
    throw new Error(`Unsupported form field name: ${name}`);
  return `[name="${name}"]`;
};

export async function inspectForm(page: Page): Promise<FormSnapshot> {
  const url = page.url();
  const origin = new URL(url).origin;
  const raw = await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("form[data-job-id]");
    if (!form) throw new Error("Supported application form was not found.");
    const active = [...form.querySelectorAll("fieldset")].find((field) => !field.hidden);
    if (!active) throw new Error("The application form has no active step.");
    const seenRadio = new Set<string>();
    const fields = [
      ...active.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input[name],select[name],textarea[name]",
      ),
    ]
      .filter((field) => {
        if (field.closest("[hidden]")) return false;
        if (field instanceof HTMLInputElement && field.type === "hidden") return false;
        if (field instanceof HTMLInputElement && field.type === "radio") {
          if (seenRadio.has(field.name)) return false;
          seenRadio.add(field.name);
        }
        return true;
      })
      .map((field) => {
        const inputType =
          field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase();
        const kind = field instanceof HTMLInputElement && field.list ? "autocomplete" : inputType;
        const options =
          field instanceof HTMLInputElement && field.type === "radio"
            ? [...active.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
                .filter((item) => item.name === field.name)
                .map((item) => ({
                  label: item.labels?.[0]?.textContent?.trim() ?? item.value,
                  value: item.value,
                }))
            : field instanceof HTMLSelectElement
              ? [...field.options]
                  .filter((option) => option.value)
                  .map((option) => ({ label: option.label, value: option.value }))
              : field instanceof HTMLInputElement && field.list
                ? [...field.list.options].map((option) => ({
                    label: option.label || option.value,
                    value: option.value,
                  }))
                : [];
        const label =
          (field instanceof HTMLInputElement && field.type === "radio"
            ? field.closest('[role="group"]')?.getAttribute("aria-label")
            : field.labels?.[0]?.textContent?.trim().replace(/\s+/g, " ")) ??
          field.getAttribute("aria-label") ??
          "";
        return {
          name: field.name,
          semanticKey: field.getAttribute("data-semantic-key") ?? field.name,
          label,
          kind: [
            "text",
            "email",
            "tel",
            "textarea",
            "select",
            "radio",
            "checkbox",
            "date",
            "file",
            "autocomplete",
          ].includes(kind)
            ? kind
            : "unsupported",
          required: field.required,
          maxLength:
            field instanceof HTMLSelectElement || field.maxLength <= 0 ? null : field.maxLength,
          options,
        };
      });
    return {
      jobId: form.dataset.jobId ?? "",
      step: Number(active.id.replace("step-", "")),
      fields,
      blocker: document.querySelector("[data-challenge]:not([hidden])") ? "challenge" : "none",
    };
  });
  const fields = raw.fields as FormField[];
  const structure = { origin, jobId: raw.jobId, step: raw.step, fields };
  return formSnapshotSchema.parse({
    ...structure,
    url,
    fingerprint: hash(structure),
    blocker: raw.blocker,
  });
}

export function planFields(
  snapshot: FormSnapshot,
  packet: PacketSnapshot,
  approvedValues: Record<string, string | boolean> = {},
): FieldPlan {
  if (snapshot.jobId !== packet.manifest.jobId)
    throw new Error("Form and packet job identities do not match.");
  const identity = packet.content.cv.identity;
  const cv = packet.manifest.artifacts.find((artifact) => artifact.kind === "cv_pdf");
  const known: Record<string, { value: string | boolean; evidence: string[] }> = {
    full_name: { value: identity.fullName, evidence: identity.evidence.map((item) => item.factId) },
    email: { value: identity.email, evidence: identity.evidence.map((item) => item.factId) },
    phone: { value: identity.phone, evidence: identity.evidence.map((item) => item.factId) },
    motivation: {
      value: `${packet.content.letter.opening} ${packet.content.letter.contributions.map((item) => item.text).join(" ")}`,
      evidence: packet.content.letter.contributions.flatMap((item) =>
        item.evidence.map((fact) => fact.factId),
      ),
    },
    portfolio: {
      value: identity.links[0] ?? "",
      evidence: identity.evidence.map((item) => item.factId),
    },
    ...(cv ? { cv: { value: cv.filename, evidence: [cv.sha256] } } : {}),
  };
  for (const answer of packet.content.answers) {
    if (answer.status !== "deferred" && answer.answer !== null)
      known[answer.semanticKey] = {
        value: String(answer.answer),
        evidence: answer.evidence.map((fact) => fact.factId),
      };
  }
  for (const [key, value] of Object.entries(approvedValues)) known[key] = { value, evidence: [] };
  const entries: FieldPlan["entries"] = [];
  const unresolved: string[] = [];
  for (const field of snapshot.fields) {
    const candidate = known[field.semanticKey];
    if (!candidate || field.kind === "unsupported") {
      if (field.required) unresolved.push(field.semanticKey);
      continue;
    }
    let expected = candidate.value;
    if (
      field.required &&
      ((typeof expected === "string" && !expected.trim()) ||
        (field.kind === "checkbox" && expected === false))
    ) {
      unresolved.push(field.semanticKey);
      continue;
    }
    if (field.kind === "checkbox" && typeof expected !== "boolean") {
      if (field.required) unresolved.push(field.semanticKey);
      continue;
    }
    if (["select", "radio", "autocomplete"].includes(field.kind)) {
      const option = field.options.find(
        (item) => item.value === String(expected) || item.label === String(expected),
      );
      if (!option) {
        if (field.required) unresolved.push(field.semanticKey);
        continue;
      }
      expected = option.value;
    }
    if (field.maxLength && String(expected).length > field.maxLength) {
      if (field.required) unresolved.push(field.semanticKey);
      continue;
    }
    entries.push({
      name: field.name,
      semanticKey: field.semanticKey,
      expected,
      evidence: candidate.evidence,
    });
  }
  return fieldPlanSchema.parse({ fingerprint: snapshot.fingerprint, entries, unresolved });
}

export async function fillStep(page: Page, plan: FieldPlan, cvPdf: Buffer): Promise<FillReport> {
  const snapshot = await inspectForm(page);
  if (snapshot.fingerprint !== plan.fingerprint)
    throw new Error("Form questions changed after the answer plan was created.");
  if (snapshot.blocker === "challenge")
    return fillReportSchema.parse({
      snapshot,
      status: "challenge",
      readBack: [],
      uploadStatus: "idle",
      issues: ["Verification challenge requires owner action."],
    });
  const readBack: FillReport["readBack"] = [];
  let uploadStatus: FillReport["uploadStatus"] = "idle";
  const issues = [...plan.unresolved.map((item) => `Required answer unresolved: ${item}`)];
  for (const entry of plan.entries) {
    const field = snapshot.fields.find((item) => item.name === entry.name);
    if (!field) throw new Error(`Planned field ${entry.name} disappeared.`);
    const control = page.locator(selector(entry.name));
    if (field.kind === "file") {
      await control.setInputFiles({
        name: String(entry.expected),
        mimeType: "application/pdf",
        buffer: cvPdf,
      });
      await page.locator("[data-upload-status]").filter({ visible: true }).waitFor();
      await page.waitForFunction(() => {
        const status = document
          .querySelector("[data-upload-status]")
          ?.getAttribute("data-upload-status");
        return status === "accepted" || status === "failed";
      });
      uploadStatus = (await page
        .locator("[data-upload-status]")
        .getAttribute("data-upload-status")) as FillReport["uploadStatus"];
      if (uploadStatus !== "accepted") issues.push("CV upload was not accepted by the server.");
      const selectedName = await control.evaluate(
        (element) => (element as HTMLInputElement).files?.[0]?.name ?? "",
      );
      readBack.push({
        name: entry.name,
        expected: entry.expected,
        actual: selectedName,
        matches: uploadStatus === "accepted" && selectedName === entry.expected,
      });
      continue;
    }
    if (field.kind === "radio") {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(entry.expected)))
        throw new Error("Unsupported radio option value.");
      await page.locator(`${selector(entry.name)}[value="${entry.expected}"]`).check();
    } else if (field.kind === "checkbox") {
      if (entry.expected === true) await control.check();
      else await control.uncheck();
    } else if (field.kind === "select") await control.selectOption(String(entry.expected));
    else await control.fill(String(entry.expected));
    const actual =
      field.kind === "checkbox"
        ? await control.isChecked()
        : field.kind === "radio"
          ? await page.locator(`${selector(entry.name)}:checked`).inputValue()
          : await control.inputValue();
    const matches = actual === entry.expected;
    readBack.push({ name: entry.name, expected: entry.expected, actual, matches });
    if (!matches) issues.push(`Read-back differs for ${entry.semanticKey}.`);
  }
  const updated = await inspectForm(page);
  if (updated.fingerprint !== snapshot.fingerprint)
    issues.push("Conditional questions changed; a new answer plan is required.");
  return fillReportSchema.parse({
    snapshot: updated,
    status: issues.length ? (uploadStatus === "failed" ? "upload_failed" : "needs_input") : "ready",
    readBack,
    uploadStatus,
    issues,
  });
}
