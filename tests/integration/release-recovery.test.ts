import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  recoveryChildEnvironment,
  runReleaseRecovery,
} from "../../scripts/release-recovery-run.js";

it("passes an explicit browser cache but excludes all private application settings", () => {
  expect(
    recoveryChildEnvironment({
      PATH: "synthetic-path",
      PLAYWRIGHT_BROWSERS_PATH: "synthetic-owned-cache",
      AUTOPILOT_OWNER_TOKEN: "private-sentinel",
      AUTOPILOT_VAULT_KEY: "private-sentinel",
      AUTOPILOT_DATABASE_URL: "private-sentinel",
      AUTOPILOT_OPENROUTER_API_KEY: "private-sentinel",
      AUTOPILOT_DATA_DIR: "private-sentinel",
      AUTOPILOT_PROFILE: "local",
      AUTOPILOT_EXTERNAL_SUBMISSION: "true",
      UNKNOWN_CONFIG: "private-sentinel",
    }),
  ).toEqual({
    PATH: "synthetic-path",
    PLAYWRIGHT_BROWSERS_PATH: "synthetic-owned-cache",
    AUTOPILOT_SKIP_ENV_FILE: "1",
  });
});

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
