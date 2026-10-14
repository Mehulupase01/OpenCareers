import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { commitCrashBoundaries } from "../../scripts/capacity-fixture.js";
import { runCommitCrashMatrix } from "../../scripts/commit-crash-run.js";

it("kills six owned mock workers at durable boundaries and never replays an uncertain final action", async () => {
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
    expect(result.cases.filter((item) => item.acceptedMockRecords === 1)).toHaveLength(3);
    expect(result.cases.filter((item) => item.outcome === "needs_review")).toHaveLength(2);
    expect(result.cases.find((item) => item.boundary === "claimed_before_intent")).toMatchObject({
      attempts: 0,
      outcome: "retryable_before_intent",
    });
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
}, 360000);
