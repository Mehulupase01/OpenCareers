import { createHash } from "node:crypto";
import type { Page } from "playwright";
import {
  type FormField,
  type FormSnapshot,
  formSnapshotSchema,
} from "../../contracts/src/browser.js";

export interface GreenhouseTarget {
  board: string;
  postingId: string;
  formFingerprint?: string;
}

const boardPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const postingPattern = /^[0-9]{1,20}$/;

export function greenhouseUrl(target: GreenhouseTarget): string {
  if (!boardPattern.test(target.board) || !postingPattern.test(target.postingId))
    throw new Error("Unsupported Greenhouse board or posting ID.");
  return `https://job-boards.greenhouse.io/${target.board}/jobs/${target.postingId}`;
}

export async function inspectGreenhouseForm(
  page: Page,
  target: GreenhouseTarget,
): Promise<FormSnapshot> {
  const expectedUrl = greenhouseUrl(target);
  const actual = new URL(page.url());
  if (
    actual.origin !== "https://job-boards.greenhouse.io" ||
    actual.pathname !== new URL(expectedUrl).pathname
  )
    throw new Error("Greenhouse form URL does not match the target.");
  const raw = await page.evaluate(() => {
    const forms = [...document.forms].filter((form) =>
      [...form.querySelectorAll('button[type="submit"]')].some((button) =>
        /submit application/i.test(button.textContent ?? ""),
      ),
    );
    if (forms.length !== 1) throw new Error("Expected one Greenhouse application form.");
    const form = forms[0];
    if (!form) throw new Error("Greenhouse application form is missing.");
    const allControls = [
      ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input,textarea,select",
      ),
    ].filter((field) => !(field instanceof HTMLInputElement && field.type === "hidden"));
    const described = allControls.map((field, index) => {
      const observedLabel = (
        field.labels?.[0]?.textContent ??
        field.getAttribute("aria-label") ??
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      return {
        field,
        name: field.id || `unnamed_${index + 1}`,
        label: observedLabel || `Unlabeled control ${index + 1}`,
        unsupported: !field.id || !observedLabel,
        visible: field.getClientRects().length > 0,
        required:
          field.required ||
          field.getAttribute("aria-required") === "true" ||
          ["first_name", "last_name", "email", "resume"].includes(field.id) ||
          /\*\s*$/.test(observedLabel),
      };
    });
    const hiddenRequired = described
      .filter((entry) => !entry.visible && entry.required)
      .map((entry) => entry.field.id || entry.field.getAttribute("name") || "unnamed");
    const fields = described
      .filter((entry) => entry.visible)
      .map(({ field, name, label, required, unsupported }) => {
        const type = field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase();
        const semanticKey =
          field.id === "resume" ? "cv" : field.id === "cover_letter" ? "cover_letter" : name;
        return {
          name,
          semanticKey,
          label,
          kind:
            !unsupported &&
            ["text", "email", "tel", "textarea", "select", "file", "checkbox"].includes(type)
              ? type
              : "unsupported",
          required,
          maxLength:
            field instanceof HTMLSelectElement || field.maxLength <= 0 ? null : field.maxLength,
          options:
            field instanceof HTMLSelectElement
              ? [...field.options]
                  .filter((option) => option.value)
                  .map((option) => ({ label: option.label, value: option.value }))
              : [],
        };
      });
    const challenge = document.querySelector(
      'script[src*="/recaptcha/"],iframe[src*="/recaptcha/"],iframe[src*="captcha"],iframe[src*="challenge"],[data-sitekey],.g-recaptcha,.h-captcha',
    );
    return {
      fields,
      hiddenRequired,
      blocker: challenge
        ? "challenge"
        : form.querySelector('input[type="password"]')
          ? "login"
          : hiddenRequired.length || described.some((entry) => entry.visible && entry.unsupported)
            ? "unsupported"
            : "none",
    };
  });
  const fields = raw.fields as FormField[];
  if (
    fields.length === 0 ||
    fields.length > 100 ||
    fields.some(
      (field) => !field.name || !field.label || !/^[a-zA-Z0-9_-]{1,120}$/.test(field.name),
    ) ||
    new Set(fields.map((field) => field.name)).size !== fields.length
  )
    throw new Error("Greenhouse form has ambiguous or unsupported controls.");
  const structure = {
    origin: actual.origin,
    jobId: target.postingId,
    step: 1,
    fields,
    hiddenRequired: raw.hiddenRequired,
  };
  return formSnapshotSchema.parse({
    origin: structure.origin,
    jobId: structure.jobId,
    step: structure.step,
    fields: structure.fields,
    url: actual.toString(),
    fingerprint: createHash("sha256").update(JSON.stringify(structure)).digest("hex"),
    blocker: raw.blocker,
  });
}
