import { readdir, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { browserResources } from "../packages/browser/src/resources.js";
import { loadConfig } from "../packages/config/src/index.js";
import { connect } from "../packages/persistence/src/index.js";
import {
  type CommitCrashBoundary,
  commitCrashBoundaries,
  createCapacityFixture,
} from "./capacity-fixture.js";

process.once("disconnect", () => process.exit(1));
try {
  const raw = process.argv[3];
  if (
    process.argv.length !== 4 ||
    !process.send ||
    !process.connected ||
    !process.argv[2] ||
    !commitCrashBoundaries.includes(raw as CommitCrashBoundary)
  )
    throw new Error("Owned synthetic crash supervisor required");
  const directory = await realpath(resolve(process.argv[2]));
  if (
    !basename(directory).startsWith("opencareers-capacity-crash-") ||
    (await readdir(directory)).length
  )
    throw new Error("Fresh isolated synthetic storage required");
  const boundary = raw as CommitCrashBoundary;
  const repository = await connect({ ...loadConfig({}), dataDir: directory });
  try {
    const cycle = await createCapacityFixture(repository, directory, {
      interruptAfterAuthorization: boundary === "authorized_without_click",
      failReceiptWrite: boundary === "receipt_write_failed",
      afterCommitBoundary: async (observed) => {
        if (boundary === "receipt_write_failed" && observed === "accepted_before_receipt") {
          await repository.db.query(
            "CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON receipts BEGIN SELECT RAISE(FAIL,'Synthetic receipt storage failure'); END",
          );
          return;
        }
        if (observed !== boundary) return;
        const resources = browserResources.snapshot();
        if (
          resources.browsers ||
          resources.contexts ||
          resources.openingBrowsers ||
          resources.openingContexts
        )
          throw new Error("Crash boundary still owns a browser");
        process.send?.({ boundary, browserResourcesReleased: true });
        await new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Supervisor did not stop worker")), 60000),
        );
      },
    });
    await cycle("standard");
    throw new Error("Synthetic crash boundary was not reached");
  } finally {
    await repository.db.close();
  }
} catch {
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
