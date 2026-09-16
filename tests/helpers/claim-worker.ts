import { openPostgres, openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

const [engine, location, owner, timestamp, mode] = process.argv.slice(2);
if (!location || !owner || !timestamp) throw new Error("Missing test worker arguments");
const db = engine === "postgres" ? await openPostgres(location) : await openSqlite(location);
await migrate(db);
const repository = new Repository(db, owner, () => new Date(timestamp));
process.once("message", () => {
  void (async () => {
    try {
      const task = await repository.claim(
        `child-${process.pid}`,
        mode === "crash-submit" ? ["submit"] : ["prepare"],
        1000,
        2,
      );
      if (mode === "crash-submit" && task?.applicationId) {
        await db.transaction(async (tx) => {
          await tx.query(
            "UPDATE applications SET state='IN_FLIGHT',revision=revision+1 WHERE owner_id=$1 AND id=$2",
            [owner, task.applicationId],
          );
          await tx.query(
            "UPDATE attempts SET state='IN_FLIGHT',fence=$1 WHERE owner_id=$2 AND application_id=$3",
            [task.fence, owner, task.applicationId],
          );
        });
      }
      process.send?.({ type: "claimed", task });
      if (mode?.startsWith("crash-"))
        await new Promise(() => {
          setInterval(() => undefined, 1000);
        });
    } finally {
      await db.close();
      process.disconnect?.();
    }
  })();
});
process.send?.({ type: "ready" });
