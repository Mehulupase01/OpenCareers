import { readdir, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { browserResources } from "../packages/browser/src/resources.js";
import { loadConfig } from "../packages/config/src/index.js";
import { connect } from "../packages/persistence/src/index.js";
import { createCapacityFixture } from "./capacity-fixture.js";

process.on("disconnect", () => process.exit(1));
try {
  if (process.argv.length !== 3 || !process.send || !process.connected || !process.argv[2])
    throw new Error("Synthetic recovery worker requires its owned IPC supervisor.");
  const directory = await realpath(resolve(process.argv[2]));
  if (
    !basename(directory).startsWith("opencareers-capacity-recovery-") ||
    (await readdir(directory)).length
  )
    throw new Error("Synthetic recovery worker requires fresh empty storage.");
  const repository = await connect({ ...loadConfig({}), dataDir: directory });
  try {
    const cycle = await createCapacityFixture(repository, directory, {
      afterAcceptedResponseLoss: async () => {
        const resources = browserResources.snapshot();
        if (
          resources.browsers ||
          resources.contexts ||
          resources.openingBrowsers ||
          resources.openingContexts
        )
          throw new Error("Synthetic crash boundary still owns browser resources.");
        process.send?.({ boundary: "accepted_response_lost", browserResourcesReleased: true });
        await new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("Synthetic crash supervisor did not stop its child.")),
            60000,
          );
        });
        throw new Error("Unreachable recovery boundary.");
      },
    });
    for (const scenario of ["standard", "changed-question", "challenge"] as const)
      await cycle(scenario);
    await cycle("response-loss");
    throw new Error("Recovery worker must stop before writing uncertainty/receipt recovery.");
  } finally {
    await repository.db.close();
  }
} catch {
  if (process.connected) {
    await new Promise<void>((resolve) => process.send?.({ boundary: "failed" }, () => resolve()));
    process.disconnect();
  }
  console.error("Synthetic recovery worker refused or failed its owned mock workflow.");
  process.exitCode = 1;
}
