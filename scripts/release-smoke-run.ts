import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserResources } from "../packages/browser/src/resources.js";
import { loadConfig } from "../packages/config/src/index.js";
import { connect } from "../packages/persistence/src/index.js";
import { createCapacityFixture } from "./capacity-fixture.js";

export async function runReleaseSmoke() {
  // No caller-selected environment, target or existing data directory is accepted.
  const directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers-capacity-release-"));
  const repository = await connect({ ...loadConfig({}), dataDir: directory });
  try {
    const cycle = await createCapacityFixture(repository, directory);
    const results = [];
    for (const scenario of ["standard", "response-loss", "changed-question"] as const) {
      results.push(await cycle(scenario));
      const resources = browserResources.snapshot();
      if (
        resources.browsers ||
        resources.contexts ||
        resources.openingBrowsers ||
        resources.openingContexts
      )
        throw new Error("Release self-test leaked browser resources.");
    }
    const summary = await repository.summary("demo");
    const attempts = await repository.db.query(
      "SELECT state, COUNT(*) AS count FROM attempts WHERE owner_id=$1 GROUP BY state",
      [repository.ownerId],
    );
    if (
      summary.flow.confirmedWithReceipt !== 2 ||
      summary.flow.confirmedWithoutReceipt !== 0 ||
      summary.counts.unknown !== 0 ||
      attempts.length !== 1 ||
      attempts[0]?.state !== "CONFIRMED" ||
      Number(attempts[0]?.count) !== 2
    )
      throw new Error("Release self-test did not correlate its guarded mock receipts.");
    return {
      status: "passed" as const,
      directory,
      scenarios: results.map(({ scenario, outcome }) => ({ scenario, outcome })),
      confirmedWithReceipt: 2,
      attempts: 2,
      unresolvedOutcomes: 0,
      browserResourcesReleased: true,
      realSubmissions: false,
      realModelCalls: false,
      matchingMethod: "reviewed_synthetic_assessment_replay",
      letterMethod: "deterministic_synthetic_fixture",
      productionReleaseAccepted: false,
    };
  } finally {
    await repository.db.close();
  }
}
