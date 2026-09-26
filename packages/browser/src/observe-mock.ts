import { createHash } from "node:crypto";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { DomainError } from "../../contracts/src/index.js";
import type { MockReceiptEvidence } from "../../contracts/src/submission.js";
import type { startMockAts } from "../../mock-ats/src/server.js";
import { launchDryRunBrowser } from "./runtime.js";

type MockAts = Awaited<ReturnType<typeof startMockAts>>;

export async function observeMockReceipt(
  mock: MockAts,
  packet: PacketSnapshot,
): Promise<MockReceiptEvidence | null> {
  const records = (await mock.app.inject({ url: "/__test/records" })).json() as {
    records: Array<{ id: string; jobId: string; email: string; receivedAt: string }>;
  };
  const matches = records.records.filter(
    (record) =>
      record.jobId === packet.manifest.jobId && record.email === packet.content.cv.identity.email,
  );
  if (!matches.length) return null;
  if (matches.length !== 1)
    throw new DomainError("DUPLICATE_SUSPECTED", "Multiple mock receipts match one packet.");
  const record = matches[0];
  if (!record) return null;
  const owned = await launchDryRunBrowser(mock.url);
  try {
    const receiptUrl = `${mock.url}/receipts/${record.id}`;
    const response = await owned.page.goto(receiptUrl);
    if (response?.status() !== 200)
      throw new DomainError("RECEIPT_UNCORRELATED", "Mock receipt page is unavailable.");
    const id = await owned.page.locator("[data-receipt-id]").getAttribute("data-receipt-id");
    if (id !== record.id)
      throw new DomainError("RECEIPT_UNCORRELATED", "Mock receipt page ID differs from record.");
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
