import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { runReleaseRecovery } from "../../scripts/release-recovery-run.js";

it("kills an accepted mock worker, waits for its actual lease and reconciles without another final action", async () => {
  const result = await runReleaseRecovery();
  try {
    expect(result).toMatchObject({
      status: "passed",
      workerKilledAfterAcceptance: true,
      leaseRecovery: "actual_elapsed_lease",
      confirmedWithReceipt: 2,
      attempts: 2,
      acceptedMockApplications: 2,
      unresolvedOutcomes: 0,
      challengeHandoff: "verified_encrypted_checkpoint",
      challengeFinalActions: 0,
      browserResourcesReleased: true,
      realSubmissions: false,
      realModelCalls: false,
      productionReleaseAccepted: false,
    });
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
}, 120000);
