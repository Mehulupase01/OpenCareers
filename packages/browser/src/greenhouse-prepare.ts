import { createHash } from "node:crypto";
import { type BrowserContext, chromium, type Page } from "playwright";
import {
  type DryRunResult,
  dryRunResultSchema,
  type FieldPlan,
  type FillReport,
  type FormSnapshot,
  fillReportSchema,
} from "../../contracts/src/browser.js";
import type { BrowserSessionState } from "../../contracts/src/browser-session.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { type FormAnswerGuard, packetEvidenceGuard } from "./answer-guard.js";
import { fillAndReadNativeControl, installReadOnlyFormRoutes } from "./form-controls.js";
import {
  type GreenhouseTarget,
  greenhouseUrl,
  inspectGreenhouseForm,
} from "./greenhouse-inspect.js";
import { planGreenhouseFields } from "./greenhouse-plan.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function packetCv(target: GreenhouseTarget, packet: PacketSnapshot, cvPdf: Buffer) {
  if (!packet.valid || packet.manifest.validation.status === "blocked")
    throw new Error("The packet is not valid for Greenhouse preparation.");
  const packetUrl = new URL(packet.content.job.url);
  packetUrl.search = "";
  packetUrl.hash = "";
  if (packetUrl.toString().replace(/\/$/, "") !== greenhouseUrl(target))
    throw new Error("Packet vacancy URL does not match the Greenhouse posting.");
  const cv = packet.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!cv || createHash("sha256").update(cvPdf).digest("hex") !== cv.sha256)
    throw new Error("Greenhouse CV bytes do not match the packet.");
  return cv;
}

export async function installGreenhouseReadOnlyRoutes(
  context: BrowserContext,
  onBlockedWrite: () => void,
) {
  await installReadOnlyFormRoutes(context, onBlockedWrite);
}

export function greenhousePreparationResult(
  target: GreenhouseTarget,
  packet: PacketSnapshot,
  cvPdf: Buffer,
  approvedValues: Record<string, string | boolean>,
  snapshot: FormSnapshot,
  blockedWriteCount: number,
  fillReport?: FillReport,
  validatedPlan?: FieldPlan,
): DryRunResult {
  packetCv(target, packet, cvPdf);
  const plan = validatedPlan ?? planGreenhouseFields(snapshot, packet, approvedValues);
  const issues = [
    ...plan.unresolved.map((key) => `Required answer unresolved: ${key}`),
    ...(snapshot.blocker === "challenge" ? ["Verification challenge is present."] : []),
    ...(snapshot.blocker === "login" ? ["Login is required."] : []),
    ...(snapshot.blocker === "unsupported" ? ["Form variant is unsupported."] : []),
    ...(blockedWriteCount ? ["The form attempted a write during read-only preparation."] : []),
    ...(fillReport?.issues ?? []),
    ...(target.formFingerprint !== snapshot.fingerprint
      ? ["The inspected form fingerprint is not explicitly supported."]
      : []),
  ];
  const status =
    snapshot.blocker === "challenge"
      ? "challenge"
      : fillReport?.uploadStatus === "failed"
        ? "upload_failed"
        : snapshot.blocker !== "none" || blockedWriteCount
          ? "unsupported"
          : plan.unresolved.length
            ? "needs_input"
            : target.formFingerprint !== snapshot.fingerprint || !fillReport
              ? "unsupported"
              : fillReport.issues.length || fillReport.readBack.some((entry) => !entry.matches)
                ? "unsupported"
                : "ready";
  return dryRunResultSchema.parse({
    adapter: {
      id: "greenhouse",
      version: "greenhouse-hosted-v1",
      targetFingerprint: hash(target),
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
        readBack: fillReport?.readBack ?? [],
        uploadStatus: fillReport?.uploadStatus ?? "idle",
        issues,
      },
    ],
    issues,
    blockedFinalActions: blockedWriteCount,
    serverApplicationCount: 0,
    preparedAt: new Date().toISOString(),
  });
}

export async function fillGreenhouseForm(
  page: Page,
  target: GreenhouseTarget,
  snapshot: FormSnapshot,
  plan: FieldPlan,
  packet: PacketSnapshot,
  cvPdf: Buffer,
): Promise<FillReport> {
  const cv = packetCv(target, packet, cvPdf);
  const current = await inspectGreenhouseForm(page, target);
  if (snapshot.blocker !== "none" || current.blocker !== "none")
    throw new Error("Greenhouse form is blocked; filling is not permitted.");
  if (current.fingerprint !== snapshot.fingerprint || plan.fingerprint !== snapshot.fingerprint)
    throw new Error("Greenhouse form changed after planning.");
  if (plan.unresolved.length) throw new Error("Greenhouse plan has unresolved fields.");
  const byName = new Map(snapshot.fields.map((field) => [field.name, field]));
  const names = new Set<string>();
  for (const entry of plan.entries) {
    const field = byName.get(entry.name);
    if (!field || names.has(entry.name) || field.semanticKey !== entry.semanticKey)
      throw new Error("Greenhouse plan does not match the inspected controls.");
    names.add(entry.name);
    if (
      field.kind === "unsupported" ||
      field.kind === "radio" ||
      field.kind === "date" ||
      field.kind === "autocomplete"
    )
      throw new Error(`Unsupported Greenhouse control: ${entry.name}`);
    if (
      field.kind === "checkbox"
        ? typeof entry.expected !== "boolean"
        : typeof entry.expected !== "string"
    )
      throw new Error(`Invalid Greenhouse value: ${entry.name}`);
    if (field.kind === "select" && !field.options.some((option) => option.value === entry.expected))
      throw new Error(`Invalid Greenhouse selection: ${entry.name}`);
    if (field.kind === "file" && (entry.semanticKey !== "cv" || entry.expected !== cv.filename))
      throw new Error("Greenhouse CV plan does not match the packet.");
  }
  if (snapshot.fields.some((field) => field.required && !names.has(field.name)))
    throw new Error("Greenhouse plan omits a required control.");
  const form = page
    .locator("form")
    .filter({ has: page.locator('button[type="submit"]', { hasText: /submit application/i }) });
  if ((await form.count()) !== 1) throw new Error("Greenhouse application form changed.");
  const readBack: FillReport["readBack"] = [];
  const issues: string[] = [];
  let uploadStatus: FillReport["uploadStatus"] = "idle";
  for (const entry of plan.entries) {
    const field = byName.get(entry.name);
    if (!field) throw new Error("Greenhouse plan does not match the inspected controls.");
    const control = form.locator(`[id="${entry.name}"]`);
    if (
      (await control.count()) !== 1 ||
      !(await control.isVisible()) ||
      !(await control.isEnabled())
    )
      throw new Error(`Greenhouse control changed: ${entry.name}`);
    const actualKind = await control.evaluate((element) =>
      element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase(),
    );
    if (actualKind !== field.kind) throw new Error(`Greenhouse control changed: ${entry.name}`);
    let actual: string | boolean;
    let matches: boolean;
    if (field.kind === "file") {
      await control.setInputFiles({
        name: cv.filename,
        mimeType: "application/pdf",
        buffer: cvPdf,
      });
      const selected = await control.evaluate(async (element) => {
        const file = (element as HTMLInputElement).files?.[0];
        return file
          ? { name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) }
          : null;
      });
      actual = selected?.name ?? "";
      matches =
        actual === entry.expected &&
        selected !== null &&
        createHash("sha256").update(Buffer.from(selected.bytes)).digest("hex") === cv.sha256;
      uploadStatus = matches ? "selected" : "failed";
    } else {
      ({ actual, matches } = await fillAndReadNativeControl(control, field.kind, entry.expected));
    }
    readBack.push({ name: entry.name, expected: entry.expected, actual, matches });
    if (!matches) issues.push(`Greenhouse read-back mismatch: ${entry.name}`);
  }
  const after = await inspectGreenhouseForm(page, target);
  if (after.fingerprint !== snapshot.fingerprint || after.blocker !== "none")
    issues.push("Greenhouse form changed during filling.");
  return fillReportSchema.parse({
    snapshot,
    status: uploadStatus === "failed" ? "upload_failed" : issues.length ? "unsupported" : "ready",
    readBack,
    uploadStatus,
    issues,
  });
}

export async function prepareGreenhousePacket(
  target: GreenhouseTarget,
  packet: PacketSnapshot,
  cvPdf: Buffer,
  approvedValues: Record<string, string | boolean>,
  configureContext?: (context: BrowserContext) => Promise<void>,
  validateAnswers: FormAnswerGuard = packetEvidenceGuard(packet),
  browserSession?: BrowserSessionState,
): Promise<DryRunResult> {
  packetCv(target, packet, cvPdf);
  const url = greenhouseUrl(target);
  const browser = await chromium.launch({ headless: true });
  try {
    let blockedWriteCount = 0;
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultTimeout(10000);
    if (browserSession) await context.addCookies(browserSession.cookies);
    context.setDefaultNavigationTimeout(20000);
    await configureContext?.(context);
    await installGreenhouseReadOnlyRoutes(context, () => {
      blockedWriteCount++;
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    const snapshot = await inspectGreenhouseForm(page, target);
    snapshot.jobId = packet.manifest.jobId;
    const plan = await validateAnswers(
      snapshot,
      planGreenhouseFields(snapshot, packet, approvedValues),
    );
    const fillReport =
      snapshot.blocker === "none" && !plan.unresolved.length && !blockedWriteCount
        ? await fillGreenhouseForm(page, target, snapshot, plan, packet, cvPdf)
        : undefined;
    return greenhousePreparationResult(
      target,
      packet,
      cvPdf,
      approvedValues,
      snapshot,
      blockedWriteCount,
      fillReport,
      plan,
    );
  } finally {
    await browser.close();
  }
}
