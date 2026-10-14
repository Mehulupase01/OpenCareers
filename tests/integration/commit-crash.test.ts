import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { commitCrashBoundaries } from "../../scripts/capacity-fixture.js";
import { runCommitCrashMatrix } from "../../scripts/commit-crash-run.js";

it("kills eight owned mock workers including open write transactions without replaying an uncertain final action", async () => {
  const result = await runCommitCrashMatrix();
  try {
    expect(result).toMatchObject({
      status: "passed",
      duplicateRecords: 0,
      leaseRecovery: "logical_clock_after_persisted_deadline",
      realSubmissions: false,
      realModelCalls: false,
      productionReleaseAccepted: false,
    });
    expect(result.cases.map((item) => item.boundary)).toEqual([...commitCrashBoundaries]);
    expect(
      result.cases.every(
        (item) =>
          item.workerKilled &&
          item.browserResourcesReleasedBeforeKill &&
          item.duplicateRecords === 0,
      ),
    ).toBe(true);
    expect(result.cases.filter((item) => item.acceptedMockRecords === 1)).toHaveLength(4);
    expect(result.cases.filter((item) => item.writeTransactionInterrupted)).toHaveLength(2);
    expect(result.cases.every((item) => item.databaseConsistencyVerified)).toBe(true);
    expect(result.cases.filter((item) => item.outcome === "needs_review")).toHaveLength(2);
    expect(result.cases.find((item) => item.boundary === "claimed_before_intent")).toMatchObject({
      attempts: 0,
      outcome: "retryable_before_intent",
    });
    expect(result.cases.find((item) => item.boundary === "intent_transaction_open")).toMatchObject({
      attempts: 0,
      receipts: 0,
      intents: 0,
      applicationStateBeforeRecovery: "READY",
      outcome: "retryable_before_intent",
      writeTransactionInterrupted: true,
    });
    expect(result.cases.find((item) => item.boundary === "receipt_transaction_open")).toMatchObject(
      {
        attempts: 1,
        receipts: 1,
        intents: 1,
        applicationStateBeforeRecovery: "IN_FLIGHT",
        acceptedMockRecords: 1,
        outcome: "confirmed",
        writeTransactionInterrupted: true,
      },
    );
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
}, 360000);
