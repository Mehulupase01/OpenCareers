import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type DryRunResult,
  dryRunResultSchema,
  type FormField,
  type FormSnapshot,
  formSnapshotSchema,
} from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { FormDriftError } from "../../contracts/src/index.js";
import {
  type RecruiteeReceiptEvidence,
  recruiteeReceiptEvidenceSchema,
} from "../../contracts/src/submission.js";
import { planFields } from "./adapter.js";

const tenantPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const slugPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digestEmail = (email: string) => createHash("sha256").update(email).digest("hex");

const optionSchema = z
  .object({
    id: z.union([z.number().int(), z.string()]).optional(),
    body: z.string().optional(),
    content: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();

const questionSchema = z
  .object({
    id: z.number().int().positive(),
    kind: z.string().min(1).max(80),
    required: z.boolean(),
    body: z.string().trim().min(1).max(500),
    open_question_options: z.array(optionSchema).max(100).default([]),
  })
  .passthrough();

const offerSchema = z
  .object({
    offer: z
      .object({
        id: z.number().int().positive(),
        slug: z.string().regex(slugPattern),
        careers_url: z.url(),
        status: z.literal("published"),
        updated_at: z.string().min(1).max(80),
        options_cv: z.enum(["required", "optional", "off"]),
        options_phone: z.enum(["required", "optional", "off"]),
        options_cover_letter: z.enum(["required", "optional", "off"]),
        locations_question_required: z.boolean().default(false),
        locations: z.array(z.object({ id: z.number().int().positive() }).passthrough()).max(100),
        open_questions: z.array(questionSchema).max(100),
      })
      .passthrough(),
  })
  .strict();

const createdCandidateSchema = z
  .object({
    candidate: z
      .object({
        id: z.number().int().positive(),
        emails: z.array(z.email()).min(1).max(10),
      })
      .passthrough(),
  })
  .strict();

export interface RecruiteeTarget {
  tenant: string;
  offerSlug: string;
}

export type RecruiteeRequest = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export class RecruiteeDefinitiveRejection extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Recruitee definitively rejected the application with status ${status}.`);
    this.name = "RecruiteeDefinitiveRejection";
    this.status = status;
  }
}

function targetUrls(target: RecruiteeTarget) {
  if (!tenantPattern.test(target.tenant) || !slugPattern.test(target.offerSlug))
    throw new Error("Unsupported Recruitee tenant or offer slug.");
  const origin = `https://${target.tenant}.recruitee.com`;
  const offerUrl = `${origin}/api/offers/${encodeURIComponent(target.offerSlug)}`;
  return { origin, offerUrl, submitUrl: `${offerUrl}/candidates?async=true` };
}

async function boundedJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.length > 1024 * 1024) throw new Error("Recruitee response exceeded one MiB.");
  return body ? JSON.parse(body) : null;
}

async function loadOffer(target: RecruiteeTarget, request: RecruiteeRequest) {
  const urls = targetUrls(target);
  const response = await request(urls.offerUrl, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Recruitee offer read failed with status ${response.status}.`);
  const parsed = offerSchema.parse(await boundedJson(response));
  if (parsed.offer.slug !== target.offerSlug)
    throw new Error("Recruitee returned a different offer slug.");
  return { offer: parsed.offer, urls };
}

function questionField(question: z.infer<typeof questionSchema>): FormField {
  const kind: FormField["kind"] =
    question.kind === "string" || question.kind === "salary" || question.kind === "number"
      ? "text"
      : question.kind === "text"
        ? "textarea"
        : question.kind === "date"
          ? "date"
          : question.kind === "single_choice"
            ? "select"
            : question.kind === "boolean"
              ? "radio"
              : question.kind === "legal"
                ? "checkbox"
                : "unsupported";
  return {
    name: `question_${question.id}`,
    semanticKey: `recruitee_question_${question.id}`,
    label: question.body,
    kind,
    required: question.required,
    maxLength: null,
    options:
      question.kind === "boolean"
        ? [
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ]
        : question.open_question_options.flatMap((item) => {
            const value = item.body ?? item.content ?? item.title;
            return value ? [{ label: value, value }] : [];
          }),
  };
}

function snapshotFor(
  target: RecruiteeTarget,
  packet: PacketSnapshot,
  loaded: Awaited<ReturnType<typeof loadOffer>>,
): FormSnapshot {
  const { offer, urls } = loaded;
  const packetUrl = new URL(packet.content.job.url);
  packetUrl.search = "";
  packetUrl.hash = "";
  const careersUrl = new URL(offer.careers_url);
  careersUrl.search = "";
  careersUrl.hash = "";
  const tenantOfferUrl = `${urls.origin}/o/${encodeURIComponent(target.offerSlug)}`;
  if (
    packetUrl.toString().replace(/\/$/, "") !== careersUrl.toString().replace(/\/$/, "") &&
    packetUrl.toString().replace(/\/$/, "") !== tenantOfferUrl
  )
    throw new Error("Packet vacancy URL does not match the Recruitee offer.");
  const fields: FormField[] = [
    {
      name: "name",
      semanticKey: "full_name",
      label: "Full name",
      kind: "text",
      required: true,
      maxLength: null,
      options: [],
    },
    {
      name: "email",
      semanticKey: "email",
      label: "Email address",
      kind: "email",
      required: true,
      maxLength: null,
      options: [],
    },
  ];
  if (offer.options_phone !== "off")
    fields.push({
      name: "phone",
      semanticKey: "phone",
      label: "Phone number",
      kind: "tel",
      required: offer.options_phone === "required",
      maxLength: null,
      options: [],
    });
  if (offer.options_cv !== "off")
    fields.push({
      name: "cv",
      semanticKey: "cv",
      label: "CV or resume",
      kind: "file",
      required: offer.options_cv === "required",
      maxLength: null,
      options: [],
    });
  if (offer.options_cover_letter !== "off")
    fields.push({
      name: "cover_letter",
      semanticKey: "motivation",
      label: "Cover letter",
      kind: "textarea",
      required: offer.options_cover_letter === "required",
      maxLength: null,
      options: [],
    });
  fields.push(...offer.open_questions.map(questionField));
  const structure = {
    adapter: "recruitee-v1",
    tenant: target.tenant,
    offerId: offer.id,
    offerSlug: offer.slug,
    updatedAt: offer.updated_at,
    jobId: packet.manifest.jobId,
    fields,
  };
  const unsupportedLocation = offer.locations_question_required && offer.locations.length !== 1;
  return formSnapshotSchema.parse({
    url: urls.offerUrl,
    origin: urls.origin,
    jobId: packet.manifest.jobId,
    step: 1,
    fields,
    fingerprint: digest(structure),
    blocker: unsupportedLocation ? "unsupported" : "none",
  });
}

function assertPacket(packet: PacketSnapshot, cvPdf: Buffer) {
  if (!packet.valid || packet.manifest.validation.status === "blocked")
    throw new Error("The packet is not valid for Recruitee preparation.");
  const artifact = packet.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!artifact || createHash("sha256").update(cvPdf).digest("hex") !== artifact.sha256)
    throw new Error("The CV bytes do not match the packet manifest.");
}

export async function prepareRecruiteePacket(
  target: RecruiteeTarget,
  packet: PacketSnapshot,
  cvPdf: Buffer,
  approvedValues: Record<string, string | boolean>,
  request: RecruiteeRequest = fetch,
): Promise<DryRunResult> {
  assertPacket(packet, cvPdf);
  const loaded = await loadOffer(target, request);
  const snapshot = snapshotFor(target, packet, loaded);
  const plan = planFields(snapshot, packet, approvedValues);
  const unsupported = snapshot.fields.filter(
    (field) => field.required && field.kind === "unsupported",
  );
  const issues = [
    ...plan.unresolved.map((item) => `Required answer unresolved: ${item}`),
    ...unsupported.map((field) => `Required field type is unsupported: ${field.semanticKey}`),
    ...(snapshot.blocker === "unsupported" ? ["Multiple required locations are unsupported."] : []),
  ];
  const status = issues.length ? "unsupported" : "ready";
  return dryRunResultSchema.parse({
    adapter: {
      id: "recruitee",
      version: "recruitee-careers-v1",
      targetFingerprint: digest(target),
    },
    packetId: packet.manifest.id,
    applicationId: packet.manifest.applicationId,
    status,
    snapshots: [snapshot],
    plans: [plan],
    reports: [
      {
        snapshot,
        status,
        readBack: plan.entries.map((entry) => ({
          name: entry.name,
          expected: entry.expected,
          actual: entry.expected,
          matches: true,
        })),
        uploadStatus: plan.entries.some((entry) => entry.name === "cv") ? "selected" : "idle",
        issues,
      },
    ],
    issues,
    blockedFinalActions: 0,
    serverApplicationCount: 0,
    preparedAt: new Date().toISOString(),
  });
}

function appendQuestion(form: FormData, index: number, field: FormField, value: string | boolean) {
  const id = field.name.replace("question_", "");
  const prefix = `candidate[open_question_answers_attributes][${index}]`;
  form.append(`${prefix}[open_question_id]`, id);
  if (field.kind === "checkbox" || field.kind === "radio")
    form.append(`${prefix}[flag]`, String(value));
  else form.append(`${prefix}[content]`, String(value));
}

export async function commitRecruiteePacket(
  target: RecruiteeTarget,
  packet: PacketSnapshot,
  cvPdf: Buffer,
  preparation: DryRunResult,
  authorizeDispatch: () => Promise<{ expiresAt: string }>,
  request: RecruiteeRequest = fetch,
  clock: () => Date = () => new Date(),
): Promise<RecruiteeReceiptEvidence> {
  assertPacket(packet, cvPdf);
  if (preparation.status !== "ready" || preparation.snapshots.length !== 1)
    throw new Error("A ready Recruitee preparation is required.");
  const loaded = await loadOffer(target, request);
  const current = snapshotFor(target, packet, loaded);
  if (current.fingerprint !== preparation.snapshots[0]?.fingerprint)
    throw new FormDriftError(
      "RECRUITEE_FIELDS_CHANGED",
      "Recruitee offer fields changed after preparation.",
    );
  const plan = preparation.plans[0];
  if (!plan || plan.unresolved.length)
    throw new Error("Recruitee preparation has unresolved fields.");
  const values = new Map(plan.entries.map((entry) => [entry.name, entry.expected]));
  const form = new FormData();
  form.append("candidate[name]", String(values.get("name")));
  form.append("candidate[email]", String(values.get("email")));
  if (values.has("phone")) form.append("candidate[phone]", String(values.get("phone")));
  if (values.has("cover_letter"))
    form.append("candidate[cover_letter]", String(values.get("cover_letter")));
  const cv = packet.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (values.has("cv") && cv)
    form.append(
      "candidate[cv]",
      new Blob([Uint8Array.from(cvPdf)], { type: "application/pdf" }),
      cv.filename,
    );
  let questionIndex = 0;
  for (const field of current.fields) {
    if (!field.name.startsWith("question_") || !values.has(field.name)) continue;
    appendQuestion(form, questionIndex++, field, values.get(field.name) as string | boolean);
  }
  const permit = await authorizeDispatch();
  if (Date.parse(permit.expiresAt) <= clock().getTime())
    throw new Error("Recruitee dispatch permit expired before the request.");
  const response = await request(loaded.urls.submitUrl, {
    method: "POST",
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 422) {
    await boundedJson(response);
    throw new RecruiteeDefinitiveRejection(response.status);
  }
  if (response.status !== 201)
    throw new Error(`Recruitee submission outcome is unknown after status ${response.status}.`);
  const created = createdCandidateSchema.parse(await boundedJson(response));
  const email = packet.content.cv.identity.email;
  if (!created.candidate.emails.some((item) => item.toLowerCase() === email.toLowerCase()))
    throw new Error("Recruitee receipt email does not match the packet.");
  return recruiteeReceiptEvidenceSchema.parse({
    kind: "recruitee",
    candidateId: created.candidate.id,
    tenant: target.tenant,
    offerSlug: target.offerSlug,
    jobId: packet.manifest.jobId,
    responseUrl: loaded.urls.submitUrl,
    receivedAt: clock().toISOString(),
    emailHash: digestEmail(email),
  });
}
