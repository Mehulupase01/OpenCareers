import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { sourceInputSchema } from "../packages/contracts/src/discovery.js";
import { pollSource } from "../packages/discovery/src/connectors.js";
import { openSqlite } from "../packages/persistence/src/database.js";
import { DiscoveryRepository } from "../packages/persistence/src/discovery-repository.js";
import { migrate } from "../packages/persistence/src/migrations.js";

// This command never reads app configuration, the owner's DB or the local .env.
const args = process.argv.slice(2);
if (args.length !== 4)
  throw new Error("Usage: probe-public-source <connector> <board> <global|eu> <company>");
const sourceInput = sourceInputSchema.parse({
  connector: args[0],
  board: args[1],
  region: args[2],
  company: args[3],
  employerId: `public-probe-${randomUUID()}`,
  expectedRevision: 0,
  intervalSeconds: 1200,
  enabled: true,
  mode: "live",
});
await mkdir(".cache", { recursive: true });
const directory = await mkdtemp(join(".cache", `${sourceInput.connector}-public-read-`));
const database = join(directory, "evidence.sqlite");
const db = await openSqlite(database);
try {
  await migrate(db);
  const repo = new DiscoveryRepository(db, `public-read-${randomUUID()}`);
  await repo.initialize();
  await repo.saveSource(sourceInput);
  const source = await repo.claimSource();
  if (!source) throw new Error("Fresh public source lease missing.");
  const batch = await pollSource(source);
  await repo.ingest(source, batch);
  console.log(
    JSON.stringify(
      {
        database,
        connector: source.connector,
        count: batch.jobs.length,
        warnings: batch.warnings,
        pages: batch.pages.map(({ body: _body, ...evidence }) => evidence),
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
