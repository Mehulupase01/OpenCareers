import { createHash } from "node:crypto";
import { type BrowserContext, chromium } from "playwright";
import {
  type DryRunResult,
  dryRunResultSchema,
  type FormSnapshot,
} from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import {
  type GreenhouseTarget,
  greenhouseUrl,
  inspectGreenhouseForm,
} from "./greenhouse-inspect.js";
import { planGreenhouseFields } from "./greenhouse-plan.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function installGreenhouseReadOnlyRoutes(
  context: BrowserContext,
  onBlockedWrite: () => void,
) {
  await context.route("**/*", async (route) => {
    if (["GET", "HEAD"].includes(route.request().method())) return route.continue();
    onBlockedWrite();
    return route.fulfill({ status: 409, body: "Read-only preparation blocked this request." });
  });
}

export function greenhousePreparationResult(
  target: GreenhouseTarget,
  packet: PacketSnapshot,
  cvPdf: Buffer,
  approvedValues: Record<string, string | boolean>,
  snapshot: FormSnapshot,
  blockedWriteCount: number,
): DryRunResult {
  const cv = packet.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!cv || createHash("sha256").update(cvPdf).digest("hex") !== cv.sha256)
    throw new Error("Greenhouse CV bytes do not match the packet.");
  const plan = planGreenhouseFields(snapshot, packet, approvedValues);
  const issues = [
    ...plan.unresolved.map((key) => `Required answer unresolved: ${key}`),
    ...(snapshot.blocker === "challenge" ? ["Verification challenge is present."] : []),
    ...(snapshot.blocker === "login" ? ["Login is required."] : []),
    ...(snapshot.blocker === "unsupported" ? ["Form variant is unsupported."] : []),
    ...(blockedWriteCount ? ["The form attempted a write during read-only preparation."] : []),
  ];
  const status =
    snapshot.blocker === "challenge"
      ? "challenge"
      : snapshot.blocker !== "none" || blockedWriteCount
        ? "unsupported"
        : plan.unresolved.length
          ? "needs_input"
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
        readBack: [],
        uploadStatus: "idle",
        issues,
      },
    ],
    issues,
    blockedFinalActions: blockedWriteCount,
    serverApplicationCount: 0,
    preparedAt: new Date().toISOString(),
  });
}

export async function prepareGreenhousePacket(
  target: GreenhouseTarget,
  packet: PacketSnapshot,
  cvPdf: Buffer,
  approvedValues: Record<string, string | boolean>,
): Promise<DryRunResult> {
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
    context.setDefaultNavigationTimeout(20000);
    await installGreenhouseReadOnlyRoutes(context, () => {
      blockedWriteCount++;
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const snapshot = await inspectGreenhouseForm(page, target);
    return greenhousePreparationResult(
      target,
      packet,
      cvPdf,
      approvedValues,
      snapshot,
      blockedWriteCount,
    );
  } finally {
    await browser.close();
  }
}
