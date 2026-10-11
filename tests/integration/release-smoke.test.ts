import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { runReleaseSmoke } from "../../scripts/release-smoke-run.js";

it("correlates two mock receipts without replaying a lost response or committing an ambiguous form", async () => {
  const result = await runReleaseSmoke();
  try {
    expect(result).toMatchObject({
      status: "passed",
      confirmedWithReceipt: 2,
      attempts: 2,
      unresolvedOutcomes: 0,
      browserResourcesReleased: true,
      realSubmissions: false,
      realModelCalls: false,
      productionReleaseAccepted: false,
      scenarios: [
        { scenario: "standard", outcome: "confirmed" },
        { scenario: "response-loss", outcome: "reconciled_confirmed" },
        { scenario: "changed-question", outcome: "needs_input" },
      ],
    });
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
}, 60000);
