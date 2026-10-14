import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import BetterSqlite3 from "better-sqlite3";
import yauzl from "yauzl";
import { ZipFile } from "yazl";
import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";
import { openSqlite, sqliteVersionSafe } from "../../persistence/src/database.js";
import { migrate, migrations } from "../../persistence/src/migrations.js";
import { RestoreRepository } from "../../persistence/src/restore-repository.js";
import {
  assertSnapshotIntegrity,
  captureQuiescentSqliteSnapshot,
  snapshotSchemaVersion,
} from "../../persistence/src/sqlite-snapshot.js";
import { BackupArchiveCipher, MAX_BACKUP_BYTES } from "../../security/src/backup-storage.js";
import {
  DocumentStorage,
  MAX_DOCUMENT_BYTES,
  MAX_STORED_DOCUMENT_BYTES,
} from "../../security/src/document-storage.js";
import { VaultCipher, vaultBindingSchema, vaultEnvelopeSchema } from "../../security/src/vault.js";

const MAX_FILES = 5000;
const MAX_MANIFEST = 4 * 1024 * 1024;
const MAX_TOTAL = 768 * 1024 * 1024;
const MIN_SCHEMA =
  migrations.findIndex((statements) =>
    statements.some((sql) => sql.startsWith("CREATE TABLE hosted_origin_permissions ")),
  ) + 1;
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z
  .object({
    kind: z.enum(["database", "candidate_source", "document_artifact"]),
    path: z.string().min(1).max(240),
    sha256: hashSchema,
    bytes: z
      .number()
      .int()
      .positive()
      .max(512 * 1024 * 1024),
    storedSha256: hashSchema,
    storedBytes: z
      .number()
      .int()
      .positive()
      .max(512 * 1024 * 1024),
  })
  .strict();
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.literal("sqlite-local-files/v1"),
    ownerSha256: hashSchema,
    migrationVersion: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    files: z.array(fileSchema).min(1).max(MAX_FILES),
  })
  .strict();
type FileRecord = z.infer<typeof fileSchema>;
const commonSchema = z
  .object({
    destinationParent: z.string().min(1),
    ownerId: z.string().min(1).max(180),
    backupKey: z.string().min(1),
    vaultKey: z.string().min(1),
    allWritersStopped: z.literal(true),
    protectedDestinationReviewed: z.literal(true),
  })
  .strict();
export const captureSchema = commonSchema.extend({ dataDir: z.string().min(1) }).strict();
export const restoreSchema = commonSchema.extend({ archivePath: z.string().min(1) }).strict();
type Inventory = Omit<FileRecord, "storedBytes" | "storedSha256">;
const same = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

async function canonical(path: string, directory: boolean, bound = MAX_BACKUP_BYTES) {
  if (!isAbsolute(path) || /^(?:\\\\|\/\/)/.test(path))
    throw new Error("Absolute local recovery path required");
  const target = resolve(path),
    info = await lstat(target);
  if (
    !same(await realpath(target), target) ||
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile() || info.size > bound || info.nlink !== 1)
  )
    throw new Error("Recovery path is redirected or exceeds its bound");
  return target;
}
export async function protectedBackupParent(path: string) {
  if (/(?:^|[\\/])(?:onedrive[^\\/]*|dropbox|google drive)(?:[\\/]|$)/i.test(path))
    throw new Error("Recovery staging cannot use synced storage");
  const parent = await canonical(path, true);
  if (/^(?:\\\\|\/\/)|(?:^|[\\/])(?:onedrive[^\\/]*|dropbox|google drive)(?:[\\/]|$)/i.test(parent))
    throw new Error("Recovery staging cannot use synced or network storage");
  return parent;
}
async function allocate(parent: string, prefix: string) {
  const directory = await mkdtemp(join(parent, prefix));
  await chmod(directory, 0o700);
  await canonical(directory, true);
  return directory;
}
async function cleanup(directory: string, parent: string) {
  // Only remove a newly allocated, canonical child owned by this operation.
  if (
    !same(dirname(directory), parent) ||
    !/^opencareers-(?:snapshot|restore)-/.test(directory.slice(parent.length + 1))
  )
    return;
  try {
    await canonical(directory, true);
    await rm(directory, { recursive: true, force: true });
  } catch {
    /* Preserve redirected or inaccessible staging for manual review. */
  }
}
function expectedPath(entry: Pick<FileRecord, "kind" | "sha256">, owner: string) {
  if (entry.kind === "database") return "opencareers.sqlite";
  return entry.kind === "candidate_source"
    ? `candidate-sources/${sha(owner)}/${entry.sha256}`
    : `artifacts/sha256/${entry.sha256.slice(0, 2)}/${entry.sha256}`;
}
function validateManifest(raw: unknown, owner: string) {
  const manifest = manifestSchema.parse(raw);
  if (
    manifest.ownerSha256 !== sha(owner) ||
    manifest.migrationVersion < MIN_SCHEMA ||
    manifest.migrationVersion > migrations.length
  )
    throw new Error("Backup owner or schema mismatch");
  const paths = new Set<string>();
  let total = 0,
    databases = 0;
  for (const entry of manifest.files) {
    if (entry.path !== expectedPath(entry, owner) || paths.has(entry.path))
      throw new Error("Invalid backup inventory path");
    paths.add(entry.path);
    total += entry.storedBytes;
    if (entry.kind === "database") {
      databases++;
      if (entry.sha256 !== entry.storedSha256 || entry.bytes !== entry.storedBytes)
        throw new Error("Database identity mismatch");
    } else if (entry.bytes > MAX_DOCUMENT_BYTES || entry.storedBytes > MAX_STORED_DOCUMENT_BYTES)
      throw new Error("Document exceeds bound");
  }
  if (databases !== 1 || total > MAX_TOTAL) throw new Error("Invalid backup inventory bounds");
  return manifest;
}
function inventory(path: string, owner: string, key: string, expectedVersion: number): Inventory[] {
  const db = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
  try {
    const engine = db.prepare("SELECT sqlite_version() AS version").get() as { version: string };
    const version = snapshotSchemaVersion(db);
    if (
      !sqliteVersionSafe(engine.version) ||
      version !== expectedVersion ||
      version < MIN_SCHEMA ||
      version > migrations.length
    )
      throw new Error("Unsupported recovery schema");
    assertSnapshotIntegrity(db);
    const owners = db.prepare("SELECT id FROM owners LIMIT 2").all() as Array<{ id: string }>;
    const controls = db.prepare("SELECT data FROM controls WHERE owner_id=?").get(owner) as
      | { data: string }
      | undefined;
    if (
      owners.length !== 1 ||
      owners[0]?.id !== owner ||
      !controls ||
      JSON.parse(controls.data).stopped !== true
    )
      throw new Error("Invalid stopped owner snapshot");
    if (db.prepare("SELECT id FROM restore_runs WHERE state='open' LIMIT 1").get())
      throw new Error(
        "Complete the existing restore review before creating another recovery archive",
      );
    const vault = new VaultCipher(key);
    const secrets = db
      .prepare("SELECT id,purpose,key_version,envelope FROM vault_secrets LIMIT 5001")
      .all() as Array<{ id: string; purpose: string; key_version: number; envelope: string }>;
    if (secrets.length > MAX_FILES) throw new Error("Vault inventory exceeds bound");
    for (const secret of secrets) {
      const binding = vaultBindingSchema.parse({
        ownerId: owner,
        secretId: secret.id,
        purpose: secret.purpose,
        keyVersion: secret.key_version,
      });
      const clear = vault.open(vaultEnvelopeSchema.parse(JSON.parse(secret.envelope)), binding);
      clear.fill(0);
    }
    const output = new Map<string, Inventory>();
    for (const [table, kind] of [
      ["candidate_sources", "candidate_source"],
      ["artifacts", "document_artifact"],
    ] as const) {
      const rows = db
        .prepare(`SELECT sha256,storage_key,bytes FROM ${table} WHERE owner_id=? LIMIT 5001`)
        .all(owner) as Array<{ sha256: string; storage_key: string; bytes: number }>;
      if (rows.length > MAX_FILES) throw new Error("Document inventory exceeds bound");
      for (const row of rows) {
        hashSchema.parse(row.sha256);
        const entry = {
          kind,
          path: expectedPath({ kind, sha256: row.sha256 }, owner),
          sha256: row.sha256,
          bytes: row.bytes,
        };
        const storageKey =
          kind === "document_artifact" ? entry.path.slice("artifacts/".length) : entry.path;
        if (
          row.storage_key.replaceAll("\\", "/") !== storageKey ||
          !Number.isSafeInteger(entry.bytes) ||
          entry.bytes < 1 ||
          entry.bytes > MAX_DOCUMENT_BYTES
        )
          throw new Error("Invalid stored document identity");
        const old = output.get(entry.path);
        if (old && old.bytes !== entry.bytes)
          throw new Error("Conflicting stored document identity");
        output.set(entry.path, entry);
      }
    }
    if (output.size + 1 > MAX_FILES) throw new Error("Backup inventory exceeds bound");
    return [...output.values()].sort((a, b) => a.path.localeCompare(b.path));
  } finally {
    db.close();
  }
}
async function validateDocuments(root: string, files: Inventory[], owner: string, key: string) {
  for (const entry of files) {
    const file = await canonical(
      join(root, ...entry.path.split("/")),
      false,
      MAX_STORED_DOCUMENT_BYTES,
    );
    const stored = await readFile(file);
    const clear = new DocumentStorage(
      owner,
      entry.kind === "candidate_source" ? "candidate_source" : "document_artifact",
      true,
      key,
    ).decode(stored, entry.sha256);
    try {
      if (clear.length !== entry.bytes) throw new Error("Document length mismatch");
    } finally {
      clear.fill(0);
    }
  }
}
async function verifyZip(path: string, owner: string, extraction?: string) {
  await canonical(path, false);
  const zip = await yauzl.openPromise(path, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
    autoClose: false,
  });
  try {
    if (zip.entryCount < 2 || zip.entryCount > MAX_FILES + 1)
      throw new Error("Archive entry count exceeds bound");
    let manifest: z.infer<typeof manifestSchema> | undefined;
    const expected = new Map<string, FileRecord>();
    for await (const entry of zip.eachEntry()) {
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        entry.compressionMethod !== 0 ||
        entry.isEncrypted() ||
        (mode !== 0 && mode !== 0o100000) ||
        entry.compressedSize !== entry.uncompressedSize
      )
        throw new Error("Unsupported archive entry");
      const record = manifest ? expected.get(entry.fileName) : undefined;
      if ((!manifest && entry.fileName !== "manifest.json") || (manifest && !record))
        throw new Error("Unexpected or repeated archive entry");
      const limit = record?.storedBytes ?? MAX_MANIFEST;
      if (entry.uncompressedSize > limit) throw new Error("Oversized archive entry");
      const hash = createHash("sha256"),
        chunks: Buffer[] = [];
      let size = 0;
      let output: Awaited<ReturnType<typeof open>> | undefined;
      if (record && extraction) {
        const target = join(extraction, ...record.path.split("/"));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await canonical(dirname(target), true);
        output = await open(target, "wx", 0o600);
      }
      try {
        for await (const chunk of await zip.openReadStreamPromise(entry)) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > limit) throw new Error("Archive stream exceeded its bound");
          hash.update(bytes);
          if (!manifest) chunks.push(bytes);
          else if (output) await output.writeFile(bytes);
        }
        if (output) await output.sync();
      } finally {
        await output?.close();
      }
      if (!manifest) {
        manifest = validateManifest(JSON.parse(Buffer.concat(chunks).toString("utf8")), owner);
        if (zip.entryCount !== manifest.files.length + 1)
          throw new Error("Archive inventory count mismatch");
        for (const file of manifest.files) expected.set(file.path, file);
      } else {
        if (!record || size !== record.storedBytes || hash.digest("hex") !== record.storedSha256)
          throw new Error("Archive checksum mismatch");
        expected.delete(entry.fileName);
      }
    }
    if (!manifest || expected.size) throw new Error("Incomplete backup archive");
    return manifest;
  } finally {
    zip.close();
  }
}

export async function captureSqliteBackup(raw: z.input<typeof captureSchema>) {
  const input = captureSchema.parse(raw);
  let directory: string | undefined, parent: string | undefined;
  try {
    if (input.backupKey === input.vaultKey) throw new Error("Backup and vault keys must differ");
    const cipher = new BackupArchiveCipher(input.ownerId, input.backupKey);
    const source = await canonical(input.dataDir, true);
    parent = await protectedBackupParent(input.destinationParent);
    const snapshot = await captureQuiescentSqliteSnapshot({
      databasePath: join(source, "opencareers.sqlite"),
      destinationParent: parent,
      ownerId: input.ownerId,
      allWritersStopped: true,
      protectedDestinationReviewed: true,
    });
    directory = snapshot.directory;
    const files: FileRecord[] = [
      {
        kind: "database",
        path: "opencareers.sqlite",
        sha256: snapshot.manifest.databaseSha256,
        bytes: snapshot.manifest.databaseBytes,
        storedSha256: snapshot.manifest.databaseSha256,
        storedBytes: snapshot.manifest.databaseBytes,
      },
    ];
    const documents = inventory(
      snapshot.snapshotPath,
      input.ownerId,
      input.vaultKey,
      snapshot.manifest.migrationVersion,
    );
    const payload = join(directory, "payload");
    await mkdir(payload, { mode: 0o700 });
    let total = snapshot.manifest.databaseBytes;
    for (const entry of documents) {
      const file = await canonical(
        join(source, ...entry.path.split("/")),
        false,
        MAX_STORED_DOCUMENT_BYTES,
      );
      const stored = await readFile(file);
      const clear = new DocumentStorage(
        input.ownerId,
        entry.kind === "candidate_source" ? "candidate_source" : "document_artifact",
        true,
        input.vaultKey,
      ).decode(stored, entry.sha256);
      try {
        if (clear.length !== entry.bytes) throw new Error("Document size mismatch");
      } finally {
        clear.fill(0);
      }
      total += stored.length;
      if (total > MAX_TOTAL) throw new Error("Backup payload exceeds bound");
      const target = join(payload, ...entry.path.split("/"));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, stored, { flag: "wx", mode: 0o600 });
      files.push({ ...entry, storedSha256: sha(stored), storedBytes: stored.length });
    }
    const manifest = validateManifest(
      {
        schemaVersion: 1,
        scope: "sqlite-local-files/v1",
        ownerSha256: sha(input.ownerId),
        migrationVersion: snapshot.manifest.migrationVersion,
        createdAt: snapshot.manifest.createdAt,
        files,
      },
      input.ownerId,
    );
    const bytes = Buffer.from(JSON.stringify(manifest));
    if (bytes.length > MAX_MANIFEST) throw new Error("Backup manifest exceeds bound");
    const zip = new ZipFile(),
      zipPath = join(directory, "payload.zip");
    zip.addBuffer(bytes, "manifest.json", { compress: false, mode: 0o100600 });
    for (const entry of files)
      zip.addFile(
        entry.kind === "database" ? snapshot.snapshotPath : join(payload, ...entry.path.split("/")),
        entry.path,
        { compress: false, mode: 0o100600 },
      );
    const transfer = pipeline(
      zip.outputStream,
      createWriteStream(zipPath, { flags: "wx", mode: 0o600 }),
      { signal: AbortSignal.timeout(120000) },
    );
    zip.on("error", (error) => zip.outputStream.emit("error", error));
    zip.end();
    await transfer;
    await verifyZip(zipPath, input.ownerId);
    const archivePath = join(directory, "backup.ocb");
    await cipher.transform(zipPath, archivePath, false);
    const verified = join(directory, "verified.zip");
    await cipher.transform(archivePath, verified, true);
    await verifyZip(verified, input.ownerId);
    await rm(payload, { recursive: true });
    for (const name of [
      "payload.zip",
      "verified.zip",
      "opencareers.sqlite",
      "opencareers.sqlite-wal",
      "opencareers.sqlite-shm",
      "database-snapshot.json",
    ])
      await rm(join(directory, name), { force: true });
    return { directory, archivePath, files: files.length, scope: manifest.scope };
  } catch {
    if (directory && parent) await cleanup(directory, parent);
    throw new DomainError(
      "STORAGE_UNAVAILABLE",
      "Offline SQLite backup failed; the source was not migrated or resumed.",
    );
  }
}

export async function restoreSqliteBackup(raw: z.input<typeof restoreSchema>) {
  const input = restoreSchema.parse(raw);
  let directory: string | undefined, parent: string | undefined;
  try {
    if (input.backupKey === input.vaultKey) throw new Error("Backup and vault keys must differ");
    const cipher = new BackupArchiveCipher(input.ownerId, input.backupKey);
    const archive = await canonical(input.archivePath, false);
    parent = await protectedBackupParent(input.destinationParent);
    directory = await allocate(parent, "opencareers-restore-");
    const zipPath = join(directory, "authenticated.zip"),
      payload = join(directory, "files");
    // No entry is parsed or extracted until whole-archive AEAD authentication succeeds.
    await cipher.transform(archive, zipPath, true);
    await mkdir(payload, { mode: 0o700 });
    const manifest = await verifyZip(zipPath, input.ownerId, payload);
    const databasePath = join(payload, "opencareers.sqlite");
    const documents = inventory(
      databasePath,
      input.ownerId,
      input.vaultKey,
      manifest.migrationVersion,
    );
    const expected = manifest.files.filter((entry) => entry.kind !== "database");
    if (
      documents.length !== expected.length ||
      documents.some(
        (entry) =>
          !expected.some(
            (file) =>
              entry.path === file.path &&
              entry.sha256 === file.sha256 &&
              entry.bytes === file.bytes &&
              entry.kind === file.kind,
          ),
      )
    )
      throw new Error("Database and document archive inventories differ");
    await validateDocuments(payload, documents, input.ownerId, input.vaultKey);
    const database = manifest.files.find((entry) => entry.kind === "database");
    if (!database) throw new Error("Missing database identity");
    const db = await openSqlite(databasePath);
    let runId: string;
    try {
      await migrate(db);
      runId = await new RestoreRepository(db, input.ownerId).block(
        database.sha256,
        "system:restore",
        manifest.createdAt,
      );
    } finally {
      await db.close();
    }
    await rm(zipPath);
    const dataDir = join(directory, "data");
    await rename(payload, dataDir);
    await writeFile(
      join(directory, "RESTORE-READY.json"),
      JSON.stringify({
        schemaVersion: 1,
        scope: manifest.scope,
        snapshotSha256: database.sha256,
        backupCreatedAt: manifest.createdAt,
        runId,
        restoreBlocked: true,
        requiresExternalHistoryReview: true,
      }),
      { flag: "wx", mode: 0o600 },
    );
    return {
      directory,
      dataDir,
      runId,
      restoreBlocked: true as const,
      files: manifest.files.length,
    };
  } catch {
    if (directory && parent) await cleanup(directory, parent);
    throw new DomainError(
      "STORAGE_UNAVAILABLE",
      "Offline SQLite restore failed; no runtime was started.",
    );
  }
}
