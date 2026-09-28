import { createHash } from "node:crypto";
import { type BrowserContext, chromium } from "playwright";
import type { BrowserPreparation } from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { FormDriftError } from "../../contracts/src/index.js";
import {
  type GreenhouseReceiptEvidence,
  greenhouseReceiptEvidenceSchema,
} from "../../contracts/src/submission.js";
import {
  type GreenhouseTarget,
  greenhouseUrl,
  inspectGreenhouseForm,
} from "./greenhouse-inspect.js";
import { fillGreenhouseForm } from "./greenhouse-prepare.js";

export class GreenhouseDefinitiveRejection extends Error {
  constructor(public readonly status: number) {
    super(`Greenhouse definitively rejected the application with status ${status}.`);
    this.name = "GreenhouseDefinitiveRejection";
  }
}

export interface GreenhouseCommitOptions {
  configureContext?: (context: BrowserContext) => Promise<void>;
  clock?: () => Date;
}

const emailHash = (email: string) => createHash("sha256").update(email).digest("hex");

export async function commitGreenhousePacket(
  target: GreenhouseTarget,
  packet: PacketSnapshot,
  cvPdf: Buffer,
  preparation: BrowserPreparation,
  authorizeDispatch: () => Promise<{ expiresAt: string }>,
  options: GreenhouseCommitOptions = {},
): Promise<GreenhouseReceiptEvidence> {
  const expectedUrl = greenhouseUrl(target);
  const expected = new URL(expectedUrl);
  const preparedSnapshot = preparation.result.snapshots[0];
  const plan = preparation.result.plans[0];
  if (
    preparation.status !== "ready" ||
    preparation.result.status !== "ready" ||
    !target.formFingerprint ||
    target.formFingerprint !== preparedSnapshot?.fingerprint ||
    !plan ||
    plan.unresolved.length
  )
    throw new Error("A fingerprint-pinned ready Greenhouse preparation is required.");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(20000);
    await options.configureContext?.(context);
    let dispatchAllowed = false;
    let writes = 0;
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (["GET", "HEAD"].includes(request.method())) return route.fallback();
      const url = new URL(request.url());
      if (
        !dispatchAllowed ||
        writes > 0 ||
        request.method() !== "POST" ||
        url.origin !== expected.origin ||
        url.pathname !== expected.pathname
      ) {
        writes++;
        return route.fulfill({ status: 409, body: "Greenhouse write blocked." });
      }
      writes++;
      return route.fallback();
    });
    const page = await context.newPage();
    await page.goto(expectedUrl, { waitUntil: "networkidle" });
    const current = await inspectGreenhouseForm(page, target);
    if (
      current.fingerprint !== preparedSnapshot.fingerprint ||
      current.fingerprint !== target.formFingerprint
    )
      throw new FormDriftError(
        "GREENHOUSE_FORM_CHANGED",
        "Greenhouse form changed after preparation.",
      );
    const report = await fillGreenhouseForm(page, target, current, plan, packet, cvPdf);
    if (
      report.status !== "ready" ||
      report.uploadStatus !== "selected" ||
      report.issues.length ||
      report.readBack.some((entry) => !entry.matches) ||
      writes
    )
      throw new FormDriftError(
        "GREENHOUSE_FORM_CHANGED",
        "Greenhouse form was not stable before dispatch.",
      );
    const permit = await authorizeDispatch();
    const clock = options.clock ?? (() => new Date());
    if (Date.parse(permit.expiresAt) <= clock().getTime())
      throw new Error("Greenhouse dispatch permit expired before the final action.");
    dispatchAllowed = true;
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === expected.origin &&
        new URL(response.url()).pathname === expected.pathname,
    );
    await page.locator('form button[type="submit"]').click();
    const response = await responsePromise;
    if (response.status() === 422) throw new GreenhouseDefinitiveRejection(422);
    if (response.status() < 200 || response.status() >= 400)
      throw new Error(
        `Greenhouse submission outcome is unknown after status ${response.status()}.`,
      );
    await page.waitForLoadState("domcontentloaded");
    const receipt = await page.locator("[data-greenhouse-receipt-id]").evaluate((element) => ({
      receiptId: element.getAttribute("data-greenhouse-receipt-id"),
      postingId: element.getAttribute("data-posting-id"),
      emailHash: element.getAttribute("data-email-hash"),
    }));
    if (
      receipt.postingId !== target.postingId ||
      receipt.emailHash !== emailHash(packet.content.cv.identity.email)
    )
      throw new Error("Greenhouse receipt does not match the packet.");
    return greenhouseReceiptEvidenceSchema.parse({
      kind: "greenhouse",
      receiptId: receipt.receiptId,
      board: target.board,
      postingId: target.postingId,
      jobId: packet.manifest.jobId,
      receiptUrl: page.url(),
      receivedAt: clock().toISOString(),
      emailHash: receipt.emailHash,
    });
  } finally {
    await browser.close();
  }
}
