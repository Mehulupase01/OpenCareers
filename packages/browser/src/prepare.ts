import { createHash } from "node:crypto";
import {
  type DryRunResult,
  dryRunResultSchema,
  type FieldPlan,
  type FillReport,
  type FormSnapshot,
} from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { startMockAts } from "../../mock-ats/src/server.js";
import { fillStep, inspectForm, planFields } from "./adapter.js";
import { launchDryRunBrowser } from "./runtime.js";

export async function prepareMockPacket(
  packet: PacketSnapshot,
  cvPdf: Buffer,
  approvedValues: Record<string, string | boolean>,
  fixture = "standard",
): Promise<DryRunResult> {
  if (!packet.valid || packet.manifest.validation.status === "blocked")
    throw new Error("The packet is not valid for browser preparation.");
  const artifact = packet.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!artifact || createHash("sha256").update(cvPdf).digest("hex") !== artifact.sha256)
    throw new Error("The CV bytes do not match the packet manifest.");
  const mock = await startMockAts();
  try {
    const owned = await launchDryRunBrowser(mock.url);
    try {
      await owned.page.goto(
        `${mock.url}/jobs/${fixture}?jobId=${encodeURIComponent(packet.manifest.jobId)}`,
      );
      const firstSnapshot = await inspectForm(owned.page);
      const firstPlan = planFields(firstSnapshot, packet, approvedValues);
      const firstReport = await fillStep(owned.page, firstPlan, cvPdf);
      const snapshots: FormSnapshot[] = [firstSnapshot];
      const plans: FieldPlan[] = [firstPlan];
      const reports: FillReport[] = [firstReport];
      if (firstReport.status === "ready") {
        await owned.page.getByRole("button", { name: "Next" }).click();
        const secondSnapshot = await inspectForm(owned.page);
        const secondPlan = planFields(secondSnapshot, packet, approvedValues);
        const secondReport = await fillStep(owned.page, secondPlan, cvPdf);
        snapshots.push(secondSnapshot);
        plans.push(secondPlan);
        reports.push(secondReport);
      }
      const issues = reports.flatMap((report) => report.issues);
      if (reports.length === 2) {
        for (const value of firstReport.readBack) {
          if (value.name === "cv") continue;
          const actual = await owned.page.locator(`[name="${value.name}"]`).inputValue();
          if (actual !== String(value.expected))
            issues.push(`Resume parsing changed ${value.name} after the first read-back.`);
        }
      }
      const status =
        reports.find((report) => report.status !== "ready")?.status ??
        (issues.length ? "needs_input" : "ready");
      const server = (await mock.app.inject({ url: "/__test/records" })).json() as {
        count: number;
      };
      if (server.count !== 0) throw new Error("A dry run created a mock application record.");
      return dryRunResultSchema.parse({
        packetId: packet.manifest.id,
        applicationId: packet.manifest.applicationId,
        status,
        snapshots,
        plans,
        reports,
        issues,
        blockedFinalActions: owned.blockedCommitCount,
        serverApplicationCount: 0,
        preparedAt: new Date().toISOString(),
      });
    } finally {
      await owned.close();
    }
  } finally {
    await mock.app.close();
  }
}
