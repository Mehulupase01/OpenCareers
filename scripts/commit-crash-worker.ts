import { readdir, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { browserResources } from "../packages/browser/src/resources.js";
import { loadConfig } from "../packages/config/src/index.js";
import type { Database, Row, SqlValue } from "../packages/persistence/src/database.js";
import { connect } from "../packages/persistence/src/index.js";
import { Repository } from "../packages/persistence/src/repository.js";
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
  const connected = await connect({ ...loadConfig({}), dataDir: directory });
  const hold = async (staged?: { attempts: number; receipts: number }) => {
    const resources = browserResources.snapshot();
    if (
      resources.browsers ||
      resources.contexts ||
      resources.openingBrowsers ||
      resources.openingContexts
    )
      throw new Error("Crash boundary still owns a browser");
    process.send?.({
      boundary,
      browserResourcesReleased: true,
      writeTransactionOpen: staged !== undefined,
      staged,
    });
    await new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Supervisor did not stop worker")), 60000),
    );
  };
  const statement =
    boundary === "intent_transaction_open"
      ? "INSERT INTO attempts("
      : boundary === "receipt_transaction_open"
        ? "INSERT INTO receipts("
        : null;
  const database: Database = {
    dialect: connected.db.dialect,
    query: (sql, values) => connected.db.query(sql, values),
    close: () => connected.db.close(),
    transaction: (operation) =>
      connected.db.transaction(async (tx) => {
        let inserted = false;
        const result = await operation({
          dialect: tx.dialect,
          async query<T extends Row>(sql: string, values?: SqlValue[]) {
            const rows = await tx.query<T>(sql, values);
            if (statement && sql.startsWith(statement)) inserted = true;
            return rows;
          },
        });
        // The real database callback has not returned: SQLite has not executed COMMIT.
        if (inserted) {
          const attempts = Number(
            (
              await tx.query("SELECT COUNT(*) AS n FROM attempts WHERE owner_id=$1", [
                connected.ownerId,
              ])
            )[0]?.n,
          );
          const receipts = Number(
            (
              await tx.query("SELECT COUNT(*) AS n FROM receipts WHERE owner_id=$1", [
                connected.ownerId,
              ])
            )[0]?.n,
          );
          if (attempts !== 1 || receipts !== (boundary === "receipt_transaction_open" ? 1 : 0))
            throw new Error(
              "Uncommitted synthetic rows were not visible inside the write transaction",
            );
          await hold({ attempts, receipts });
        }
        return result;
      }),
  };
  const repository = new Repository(database, connected.ownerId);
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
        await hold();
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
