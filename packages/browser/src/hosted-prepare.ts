import { createHash } from "node:crypto";
import { dryRunResultSchema, fillReportSchema } from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import {
  type HostedOriginPermission,
  hostedOriginPermissionSchema,
} from "../../contracts/src/hosted-preparation.js";
import { DomainError } from "../../contracts/src/index.js";
import { planFields } from "./adapter.js";
import type { FormAnswerGuard } from "./answer-guard.js";
import { fillHostedForm, inspectHostedForm } from "./hosted-form.js";
import { assertHostedPublicUrl, type HostedRead, readHostedPublic } from "./hosted-read.js";
import { browserResources } from "./resources.js";

export async function prepareHostedPacket(
  packet: PacketSnapshot,
  permissionInput: HostedOriginPermission,
  guard: FormAnswerGuard,
  read: HostedRead = readHostedPublic,
) {
  const permission = hostedOriginPermissionSchema.parse(permissionInput);
  const target = { url: packet.content.job.url, jobId: packet.manifest.jobId };
  const navigation = new URL(target.url);
  navigation.hash = "";
  if (
    !packet.valid ||
    packet.manifest.validation.status !== "valid" ||
    permission.state !== "active" ||
    Date.parse(permission.expiresAt) <= Date.now() ||
    new URL(target.url).origin !== permission.origin
  )
    throw new DomainError(
      "POLICY_REVOKED",
      "Hosted preparation requires a valid packet and current origin approval.",
    );
  assertHostedPublicUrl(target.url, permission.origin);
  const browser = await browserResources.launch({ headless: true });
  const signal = AbortSignal.timeout(60000);
  const closeOnAbort = () => {
    void browser.close().catch(() => {});
  };
  signal.addEventListener("abort", closeOnAbort, { once: true });
  try {
    let sealed = false,
      reads = 0,
      bytes = 0,
      blockedWrites = 0;
    let loadFailed = false;
    const context = await browserResources.context(browser, {
      javaScriptEnabled: false,
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(15000);
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (sealed || request.method() !== "GET") {
        if (request.method() !== "GET") blockedWrites++;
        await route.abort("blockedbyclient");
        return;
      }
      const url = new URL(request.url());
      if (
        url.origin !== permission.origin ||
        !["document", "stylesheet", "image", "font"].includes(request.resourceType()) ||
        (request.isNavigationRequest() &&
          (request.frame() !== context.pages()[0]?.mainFrame() ||
            request.url() !== navigation.href)) ||
        ++reads > 64
      ) {
        loadFailed = true;
        await route.abort("blockedbyclient");
        return;
      }
      try {
        assertHostedPublicUrl(request.url(), permission.origin);
        const resource = await read(request.url(), permission.origin, signal);
        bytes += resource.body.length;
        if (resource.body.length > 8 * 1024 * 1024 || bytes > 32 * 1024 * 1024)
          throw new Error("Hosted resource budget exceeded.");
        await route.fulfill({
          status: 200,
          contentType: resource.contentType,
          body: resource.body,
          headers: { "cache-control": "no-store" },
        });
      } catch {
        loadFailed = true;
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    await page.goto(target.url, { waitUntil: "load" });
    const snapshot = await inspectHostedForm(page, target);
    const plan = planFields(snapshot, packet);
    // Remains sealed until browser closure, including after the native fill driver's local route is removed.
    sealed = true;
    const report =
      snapshot.blocker === "none" && !plan.unresolved.length && !loadFailed && !blockedWrites
        ? await fillHostedForm(page, target, packet, snapshot, plan, async (snapshot, plan) => {
            if (signal.aborted)
              throw new DomainError("TASK_CANCELLED", "Hosted preparation deadline expired.");
            const checked = await guard(snapshot, plan);
            if (signal.aborted)
              throw new DomainError("TASK_CANCELLED", "Hosted preparation deadline expired.");
            return checked;
          })
        : fillReportSchema.parse({
            snapshot,
            status: snapshot.blocker === "challenge" ? "challenge" : "unsupported",
            readBack: [],
            uploadStatus: "idle",
            issues: [
              loadFailed || blockedWrites
                ? "Hosted resources failed the approved read-only load policy."
                : "Hosted form has unsupported, unresolved or blocked controls.",
            ],
          });
    const issues = [...report.issues, "Final submission requires a reviewed portal adapter."];
    return dryRunResultSchema.parse({
      adapter: {
        id: "hosted-readonly",
        version: "hosted-native-v1",
        targetFingerprint: createHash("sha256")
          .update(JSON.stringify({ ...target, permissionRevision: permission.revision }))
          .digest("hex"),
      },
      packetId: packet.manifest.id,
      applicationId: packet.manifest.applicationId,
      status: report.status === "challenge" ? "challenge" : "unsupported",
      snapshots: [snapshot],
      plans: [plan],
      reports: [report],
      issues,
      blockedFinalActions: blockedWrites,
      serverApplicationCount: 0,
      preparedAt: new Date().toISOString(),
    });
  } finally {
    signal.removeEventListener("abort", closeOnAbort);
    await browser.close();
  }
}
