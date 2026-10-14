import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdtemp, open, realpath, rm, rmdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";
import { sqliteVersionSafe } from "./database.js";
import { migrations } from "./migrations.js";

const inputSchema = z
  .object({
    databasePath: z.string().min(1),
    destinationParent: z.string().min(1),
    ownerId: z.string().min(1).max(180),
    allWritersStopped: z.literal(true),
    protectedDestinationReviewed: z.literal(true),
  })
  .strict();
const MAX_BYTES = 512 * 1024 * 1024;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
async function canonical(path: string, directory: boolean) {
  if (!isAbsolute(path))
    throw new DomainError("CONFIG_INVALID", "Snapshot paths must be absolute.");
  const lexical = resolve(path),
    physical = await realpath(lexical),
    info = await lstat(lexical);
  const same =
    process.platform === "win32"
      ? physical.toLowerCase() === lexical.toLowerCase()
      : physical === lexical;
  if (!same || info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()))
    throw new DomainError("STORAGE_UNAVAILABLE", "Snapshot paths cannot be redirected.");
  if (!directory && info.size > MAX_BYTES)
    throw new DomainError("STORAGE_UNAVAILABLE", "Database snapshot exceeds its byte bound.");
  return physical;
}
function schemaVersion(db: BetterSqlite3.Database) {
  const rows = db
    .prepare("SELECT version,checksum FROM schema_migrations ORDER BY version LIMIT 1001")
    .all() as Array<{ version: number; checksum: string }>;
  if (!rows.length || rows.length > migrations.length)
    throw new DomainError("MIGRATION_UNSUPPORTED", "Snapshot schema is unsupported.");
  for (const [index, row] of rows.entries()) {
    const statements = migrations[index];
    if (!statements || row.version !== index + 1 || row.checksum !== digest(statements.join("\n")))
      throw new DomainError(
        "MIGRATION_UNSUPPORTED",
        "Snapshot migration history failed verification.",
      );
  }
  return rows.length;
}
function assertQuiescent(db: BetterSqlite3.Database, ownerId: string, now: Date, version: number) {
  const owners = db.prepare("SELECT id FROM owners LIMIT 2").all() as Array<{ id: string }>;
  if (owners.length !== 1 || owners[0]?.id !== ownerId)
    throw new DomainError("UNAUTHORIZED", "Local snapshot requires exactly its configured owner.");
  const control = db.prepare("SELECT data FROM controls WHERE owner_id=?").get(ownerId) as
    | { data: string }
    | undefined;
  if (!control || JSON.parse(control.data).stopped !== true)
    throw new DomainError("POLICY_REVOKED", "Stop the runtime before snapshot capture.");
  const active = db.prepare("SELECT id FROM tasks WHERE state='leased' LIMIT 1").get();
  const uncertainDispatch = db
    .prepare("SELECT id FROM attempts WHERE state IN ('INTENT_RECORDED','IN_FLIGHT') LIMIT 1")
    .get();
  const worker = db
    .prepare("SELECT id FROM workers WHERE last_seen_at>=? LIMIT 1")
    .get(new Date(now.getTime() - 90000).toISOString());
  const poll =
    version >= 4 &&
    db.prepare("SELECT id FROM sources WHERE lease_until>? LIMIT 1").get(now.toISOString());
  if (active || uncertainDispatch || worker || poll)
    throw new DomainError(
      "STATE_INVALID",
      "Active workers, leases or dispatches must be drained before capture.",
    );
}
function integrity(db: BetterSqlite3.Database) {
  const foreignKeys = db.pragma("foreign_key_check");
  if (
    db.pragma("quick_check(1)", { simple: true }) !== "ok" ||
    !Array.isArray(foreignKeys) ||
    foreignKeys.length
  )
    throw new DomainError("STORAGE_UNAVAILABLE", "Snapshot database consistency check failed.");
}

export async function captureQuiescentSqliteSnapshot(raw: z.input<typeof inputSchema>) {
  const input = inputSchema.parse(raw);
  let source: BetterSqlite3.Database | undefined;
  let directory: string | undefined;
  let complete = false;
  try {
    const path = await canonical(input.databasePath, false);
    const parent = await canonical(input.destinationParent, true);
    source = new BetterSqlite3(path, { readonly: true, fileMustExist: true, timeout: 1000 });
    source.pragma("query_only=ON");
    const engine = source.prepare("SELECT sqlite_version() AS version").get() as {
      version: string;
    };
    if (!sqliteVersionSafe(engine.version))
      throw new DomainError("STORAGE_UNAVAILABLE", "Snapshot engine lacks the required WAL fix.");
    const version = schemaVersion(source);
    integrity(source);
    assertQuiescent(source, input.ownerId, new Date(), version);
    const dataVersion = source.pragma("data_version", { simple: true });
    const pageSize = Number(source.pragma("page_size", { simple: true }));
    directory = await mkdtemp(join(parent, "opencareers-snapshot-"));
    await chmod(directory, 0o700);
    await canonical(directory, true);
    const snapshotPath = join(directory, "opencareers.sqlite");
    const started = performance.now();
    await source.backup(snapshotPath, {
      progress: ({ totalPages }) => {
        if (totalPages * pageSize > MAX_BYTES || performance.now() - started > 30000)
          throw new DomainError(
            "STORAGE_UNAVAILABLE",
            "Snapshot transfer exceeded its time or size bound.",
          );
        return 100;
      },
    });
    await chmod(snapshotPath, 0o600);
    if (source.pragma("data_version", { simple: true }) !== dataVersion)
      throw new DomainError("REVISION_STALE", "Source changed during offline snapshot capture.");
    assertQuiescent(source, input.ownerId, new Date(), version);
    await canonical(path, false);
    const copied = new BetterSqlite3(snapshotPath, { readonly: true, fileMustExist: true });
    try {
      integrity(copied);
      if (schemaVersion(copied) !== version)
        throw new DomainError("MIGRATION_UNSUPPORTED", "Snapshot schema changed.");
    } finally {
      copied.close();
    }
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(snapshotPath)) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES)
        throw new DomainError("STORAGE_UNAVAILABLE", "Snapshot byte bound exceeded.");
      hash.update(chunk);
    }
    const manifest = {
      schemaVersion: 1,
      scope: "quiescent_sqlite_database_only",
      ownerSha256: digest(input.ownerId),
      migrationVersion: version,
      databaseSha256: hash.digest("hex"),
      databaseBytes: bytes,
      createdAt: new Date().toISOString(),
      encrypted: false,
      productionBackupAccepted: false,
    };
    const file = await open(join(directory, "database-snapshot.json"), "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(manifest, null, 2));
      await file.sync();
    } finally {
      await file.close();
    }
    complete = true;
    return { directory, snapshotPath, manifest };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("STORAGE_UNAVAILABLE", "Database snapshot capture failed.");
  } finally {
    source?.close();
    if (!complete && directory) {
      for (const name of [
        "opencareers.sqlite",
        "opencareers.sqlite-wal",
        "opencareers.sqlite-shm",
        "database-snapshot.json",
      ])
        await rm(join(directory, name), { force: true }).catch(() => {});
      await rmdir(directory).catch(() => {});
    }
  }
}
