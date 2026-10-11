import { DiscoveryYield, pollResumable } from "../../packages/discovery/src/resumable.js";
import { openPostgres, openSqlite } from "../../packages/persistence/src/database.js";
import { DiscoveryScanRepository } from "../../packages/persistence/src/discovery-scan-repository.js";
import { leverFixture } from "./discovery-fixtures.js";

const [engine, location, owner] = process.argv.slice(2);
if (!location || !owner) throw new Error("Missing synthetic worker arguments.");
const db = engine === "postgres" ? await openPostgres(location) : await openSqlite(location);
const repo = new DiscoveryScanRepository(db, owner);
const source = await repo.claimSource();
if (!source) throw new Error("Synthetic source is not claimable.");
try {
  await pollResumable(
    repo,
    source,
    async (url) => {
      const offset = Number(new URL(url).searchParams.get("skip"));
      return {
        status: 200,
        body: JSON.stringify(leverFixture(offset, 100)),
        etag: null,
        retryAfter: null,
      };
    },
    { maxReads: 2 },
  );
  throw new Error("Synthetic scan unexpectedly completed.");
} catch (error) {
  if (!(error instanceof DiscoveryYield)) throw error;
}
process.send?.({ type: "checkpointed", sourceId: source.id });
setInterval(() => {}, 1000);
