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
    const controls = [
      ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input,textarea,select",
      ),
    ].filter((field) => {
      if (field instanceof HTMLInputElement && field.type === "hidden") return false;
      return field.getClientRects().length > 0;
    });
    const fields = controls.map((field) => {
      const label = (field.labels?.[0]?.textContent ?? field.getAttribute("aria-label") ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const type = field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase();
      const semanticKey =
        field.id === "resume" ? "cv" : field.id === "cover_letter" ? "cover_letter" : field.id;
      return {
        name: field.id,
        semanticKey,
        label,
        kind: ["text", "email", "tel", "textarea", "select", "file", "checkbox"].includes(type)
          ? type
          : "unsupported",
        required:
          field.required ||
          field.getAttribute("aria-required") === "true" ||
          ["first_name", "last_name", "email", "resume"].includes(field.id) ||
          /\*\s*$/.test(label),
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
      blocker: challenge
        ? "challenge"
        : form.querySelector('input[type="password"]')
          ? "login"
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
  };
  return formSnapshotSchema.parse({
    ...structure,
    url: actual.toString(),
    fingerprint: createHash("sha256").update(JSON.stringify(structure)).digest("hex"),
    blocker: raw.blocker,
  });
}
