import { createHash } from "node:crypto";
import type { BrowserPreparation, FormSnapshot } from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import type { MockReceiptEvidence } from "../../contracts/src/submission.js";
import type { startMockAts } from "../../mock-ats/src/server.js";
import { fillStep, inspectForm, planFields } from "./adapter.js";
import { launchMockCommitBrowser } from "./runtime.js";

type MockAts = Awaited<ReturnType<typeof startMockAts>>;

function sameForm(actual: FormSnapshot, expected: FormSnapshot): boolean {
  return (
    actual.jobId === expected.jobId &&
    actual.step === expected.step &&
    JSON.stringify(actual.fields) === JSON.stringify(expected.fields) &&
    actual.blocker === "none"
  );
}

export async function commitPreparedMockPacket(
  mock: MockAts,
  packet: PacketSnapshot,
  cvPdf: Buffer,
  approvedValues: Record<string, string | boolean>,
  preparation: BrowserPreparation,
  authorizeDispatch: () => Promise<{ expiresAt: string }>,
  fixture = "standard",
): Promise<MockReceiptEvidence> {
  if (
    preparation.status !== "ready" ||
    preparation.result.packetId !== packet.manifest.id ||
    preparation.result.applicationId !== packet.manifest.applicationId ||
    preparation.result.snapshots.length !== 2
  )
    throw new Error("A matching READY preparation is required before final action.");
  const cv = packet.manifest.artifacts.find((artifact) => artifact.kind === "cv_pdf");
  if (!cv || createHash("sha256").update(cvPdf).digest("hex") !== cv.sha256)
    throw new Error("The CV no longer matches the packet manifest.");
  const owned = await launchMockCommitBrowser(mock.url);
  try {
    await owned.page.goto(
      `${mock.url}/jobs/${fixture}?jobId=${encodeURIComponent(packet.manifest.jobId)}`,
    );
    for (let index = 0; index < 2; index++) {
      const snapshot = await inspectForm(owned.page);
      const expected = preparation.result.snapshots[index];
      if (!expected || !sameForm(snapshot, expected))
        throw new Error("Mock ATS form changed since the READY preparation.");
      const plan = planFields(snapshot, packet, approvedValues);
      const filled = await fillStep(owned.page, plan, cvPdf);
      if (filled.status !== "ready" || filled.readBack.some((field) => !field.matches))
        throw new Error("Final form read-back did not match the packet.");
      if (index === 0) await owned.page.getByRole("button", { name: "Next" }).click();
    }
    const before = (await mock.app.inject({ url: "/__test/records" })).json() as {
      records: Array<{ id: string }>;
    };
    const permit = await authorizeDispatch();
    if (Date.parse(permit.expiresAt) <= Date.now())
      throw new Error("The single-use dispatch permit expired before the final action.");
    const responsePromise = owned.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/applications",
    );
    await owned.page.getByRole("button", { name: "Submit application" }).click();
    const response = await responsePromise;
    if (response.status() !== 302)
      throw new Error(`Mock ATS rejected the final application: ${response.status()}`);
    await owned.page.waitForURL("**/receipts/*");
    const receiptUrl = owned.page.url();
    const receiptId = await owned.page.locator("[data-receipt-id]").getAttribute("data-receipt-id");
    const after = (await mock.app.inject({ url: "/__test/records" })).json() as {
      records: Array<{
        id: string;
        jobId: string;
        email: string;
        receivedAt: string;
      }>;
    };
    const newRecords = after.records.filter(
      (record) => !before.records.some((item) => item.id === record.id),
    );
    const record = newRecords[0];
    if (
      newRecords.length !== 1 ||
      !record ||
      record.id !== receiptId ||
      record.jobId !== packet.manifest.jobId ||
      record.email !== packet.content.cv.identity.email ||
      new URL(receiptUrl).origin !== new URL(mock.url).origin ||
      new URL(receiptUrl).pathname !== `/receipts/${record.id}`
    )
      throw new Error("Mock ATS receipt is not correlated to a server application record.");
    return {
      kind: "mock_ats",
      recordId: record.id,
      jobId: record.jobId,
      receiptUrl,
      receivedAt: record.receivedAt,
      emailHash: createHash("sha256").update(record.email).digest("hex"),
    };
  } finally {
    await owned.close();
  }
}
