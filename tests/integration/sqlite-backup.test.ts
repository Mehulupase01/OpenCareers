import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import yauzl from "yauzl";
import { ZipFile } from "yazl";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { AccountRepository } from "../../packages/persistence/src/account-repository.js";
import { type Database, openSqlite } from "../../packages/persistence/src/database.js";
import { migrate, migrations } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { runOfflineBackup } from "../../packages/recovery/src/backup-process.js";
import {
  captureSqliteBackup,
  restoreSqliteBackup,
} from "../../packages/recovery/src/sqlite-backup.js";
import { BackupArchiveCipher } from "../../packages/security/src/backup-storage.js";
import { DocumentStorage } from "../../packages/security/src/document-storage.js";

const ownerId = "synthetic-backup-owner";
const vaultKey = Buffer.alloc(32, 17).toString("base64");
const backupKey = Buffer.alloc(32, 29).toString("base64");
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
let root: string,
  dataDir: string,
  backups: string,
  restores: string,
  db: Database,
  repo: Repository;
let artifact: { sha256: string; storageKey: string; bytes: number },
  sourcePath: string,
  appId: string;
const sourceBytes = Buffer.from("Synthetic career source. No real candidate data.");
const artifactBytes = Buffer.from("Synthetic letter, generated only for archive testing.");
const common = () => ({
  ownerId,
  vaultKey,
  backupKey,
  allWritersStopped: true as const,
  protectedDestinationReviewed: true as const,
});
const capture = () => captureSqliteBackup({ ...common(), dataDir, destinationParent: backups });
const restore = (archivePath: string) =>
  restoreSqliteBackup({ ...common(), archivePath, destinationParent: restores });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-backup-test-")));
  dataDir = join(root, "source");
  backups = join(root, "backups");
  restores = join(root, "restores");
  for (const path of [dataDir, backups, restores]) await mkdir(path);
  db = await openSqlite(join(dataDir, "opencareers.sqlite"));
  await migrate(db);
  repo = new Repository(db, ownerId);
  await repo.initialize();
  await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,'synthetic-candidate')", [ownerId]);
  const store = new ArtifactStore(
    dataDir,
    new DocumentStorage(ownerId, "document_artifact", true, vaultKey),
  );
  await store.initialize();
  artifact = await store.put(artifactBytes);
  await db.query(
    "INSERT INTO artifacts(id,owner_id,sha256,storage_key,mime_type,bytes,created_at) VALUES('synthetic-artifact',$1,$2,$3,'text/plain',$4,$5)",
    [ownerId, artifact.sha256, artifact.storageKey, artifact.bytes, new Date().toISOString()],
  );
  const hash = digest(sourceBytes),
    key = `candidate-sources/${digest(ownerId)}/${hash}`;
  sourcePath = join(dataDir, ...key.split("/"));
  await mkdir(join(dataDir, "candidate-sources", digest(ownerId)), { recursive: true });
  await writeFile(
    sourcePath,
    new DocumentStorage(ownerId, "candidate_source", true, vaultKey).encode(sourceBytes),
  );
  await db.query(
    "INSERT INTO candidate_sources(owner_id,id,candidate_id,name,sha256,bytes,storage_key,extraction,created_at) VALUES($1,'source','synthetic-candidate','Synthetic source',$2,$3,$4,'{}',$5)",
    [ownerId, hash, sourceBytes.length, key, new Date().toISOString()],
  );
  await new AccountRepository(db, ownerId, vaultKey).prepare({
    candidateId: "synthetic-candidate",
    employerOrigin: "https://careers.synthetic.example",
    adapterId: "synthetic-signup",
    identityEmail: "candidate@example.test",
  });
  await repo.putJob({
    id: "synthetic-job",
    employerId: "synthetic-employer",
    requisitionId: "synthetic-req",
    title: "Synthetic engineer",
    company: "Synthetic employer",
    location: "NL",
    url: "https://jobs.synthetic.example/one",
    description: "Synthetic backup fixture",
    source: "fixture",
    synthetic: true,
  });
  appId = (await repo.createApplication("synthetic-job", "synthetic-candidate")).id;
  await repo.setControl({ stopped: true });
});
afterEach(async () => {
  await db?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

it("round-trips encrypted documents, WAL-backed identity and vault secrets into a quarantined fresh data directory", async () => {
  await writeFile(join(dataDir, ".env"), "do-not-back-up-this-config");
  const before = await readFile(join(dataDir, "opencareers.sqlite"));
  const wal = await readFile(join(dataDir, "opencareers.sqlite-wal"));
  const result = await capture();
  expect(result.files).toBe(3);
  expect(await readdir(result.directory)).toEqual(["backup.ocb"]);
  const archive = await readFile(result.archivePath);
  expect(archive.subarray(0, 8).toString()).toBe("OCBACK01");
  expect(archive.includes(sourceBytes)).toBe(false);
  expect(archive.includes(Buffer.from("candidate@example.test"))).toBe(false);
  expect(await readFile(join(dataDir, "opencareers.sqlite"))).toEqual(before);
  expect(await readFile(join(dataDir, "opencareers.sqlite-wal"))).toEqual(wal);
  const restored = await restore(result.archivePath);
  expect(restored).toMatchObject({ restoreBlocked: true, files: 3 });
  await expect(readFile(join(restored.dataDir, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readdir(restored.directory)).sort()).toEqual(["RESTORE-READY.json", "data"]);
  const restoredDb = await openSqlite(join(restored.dataDir, "opencareers.sqlite"));
  try {
    const repository = new Repository(restoredDb, ownerId);
    expect(await repository.getControl()).toMatchObject({
      stopped: true,
      restoreBlocked: true,
      submissionsPaused: true,
    });
    expect(
      (await restoredDb.query("SELECT id FROM applications WHERE owner_id=$1", [ownerId]))[0]?.id,
    ).toBe(appId);
    expect(
      (
        await restoredDb.query("SELECT disposition FROM restore_reviews WHERE owner_id=$1", [
          ownerId,
        ])
      )[0]?.disposition,
    ).toBe("pending");
    expect(
      (
        await restoredDb.query("SELECT state FROM employer_accounts WHERE owner_id=$1", [ownerId])
      )[0]?.state,
    ).toBe("locked");
    const boundary = (
      await restoredDb.query("SELECT snapshot_created_at FROM restore_runs WHERE owner_id=$1", [
        ownerId,
      ])
    )[0]?.snapshot_created_at;
    expect(typeof boundary).toBe("string");
    expect(
      JSON.parse(await readFile(join(restored.directory, "RESTORE-READY.json"), "utf8"))
        .backupCreatedAt,
    ).toBe(boundary);
    await repository.setControl({ stopped: false, submissionsPaused: false });
    expect(await repository.claim("synthetic-restored-worker", ["submit"])).toBeNull();
    const store = new ArtifactStore(
      restored.dataDir,
      new DocumentStorage(ownerId, "document_artifact", true, vaultKey),
    );
    await store.initialize();
    expect(await store.read(artifact.storageKey, artifact.sha256)).toEqual(artifactBytes);
  } finally {
    await restoredDb.close();
  }
  expect(await readFile(result.archivePath)).toEqual(archive);
  expect((await restore(result.archivePath)).directory).not.toBe(restored.directory);
});

it("captures the preceding supported schema unchanged and migrates only the restored offline copy", async () => {
  const legacyDir = join(root, "previous-schema");
  await mkdir(legacyDir);
  const legacy = await openSqlite(join(legacyDir, "opencareers.sqlite"));
  try {
    await migrate(legacy, migrations.length - 1);
    const repository = new Repository(legacy, ownerId);
    await repository.initialize();
    await repository.setControl({ stopped: true });
    const captured = await captureSqliteBackup({
      ...common(),
      dataDir: legacyDir,
      destinationParent: backups,
    });
    expect((await legacy.query("SELECT COUNT(*) AS n FROM schema_migrations"))[0]?.n).toBe(
      migrations.length - 1,
    );
    const restored = await restore(captured.archivePath),
      copy = await openSqlite(join(restored.dataDir, "opencareers.sqlite"));
    try {
      expect((await copy.query("SELECT COUNT(*) AS n FROM schema_migrations"))[0]?.n).toBe(
        migrations.length,
      );
      expect((await new Repository(copy, ownerId).getControl()).restoreBlocked).toBe(true);
    } finally {
      await copy.close();
    }
  } finally {
    await legacy.close();
  }
});

it("rejects wrong keys and wrong owners without publishing a restore target", async () => {
  const { archivePath } = await capture();
  for (const override of [
    { backupKey: vaultKey },
    { vaultKey: backupKey },
    { backupKey: Buffer.alloc(32, 8).toString("base64") },
    { vaultKey: Buffer.alloc(32, 8).toString("base64") },
    { ownerId: "another-owner" },
  ]) {
    await expect(
      restoreSqliteBackup({ ...common(), archivePath, destinationParent: restores, ...override }),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(await readdir(restores)).toEqual([]);
  }
});

it("rejects altered headers, nonces, ciphertext, authentication tags, appended and truncated archives", async () => {
  const { archivePath } = await capture(),
    bytes = await readFile(archivePath);
  const invalid = [
    Buffer.from(bytes),
    Buffer.from(bytes),
    Buffer.from(bytes),
    Buffer.from(bytes),
    Buffer.concat([bytes, Buffer.from("extra")]),
    bytes.subarray(0, bytes.length - 20),
  ];
  for (const [index, offset] of [0, 8, 25, bytes.length - 1].entries()) {
    const value = invalid[index];
    if (value) value[offset] = (value[offset] ?? 0) ^ 1;
  }
  for (const [index, value] of invalid.entries()) {
    const path = join(root, `invalid-${index}.ocb`);
    await writeFile(path, value);
    await expect(restore(path)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(await readdir(restores)).toEqual([]);
  }
});

it("refuses missing, tampered and legacy plaintext files and inconsistent document metadata", async () => {
  const original = await readFile(sourcePath);
  await rm(sourcePath);
  await expect(capture()).rejects.toThrow();
  await writeFile(sourcePath, Buffer.from("legacy plaintext"));
  await expect(capture()).rejects.toThrow();
  const corrupted = Buffer.from(original);
  corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 1;
  await writeFile(sourcePath, corrupted);
  await expect(capture()).rejects.toThrow();
  await writeFile(sourcePath, original);
  await db.query("UPDATE candidate_sources SET bytes=bytes+1 WHERE owner_id=$1", [ownerId]);
  await expect(capture()).rejects.toThrow();
  expect(await readdir(backups)).toEqual([]);
});

it("requires explicit offline acknowledgements, existing canonical paths and separate backup keys", async () => {
  for (const override of [
    { allWritersStopped: false },
    { protectedDestinationReviewed: false },
    { backupKey: vaultKey },
  ]) {
    await expect(
      captureSqliteBackup({
        ...common(),
        dataDir,
        destinationParent: backups,
        ...override,
      } as never),
    ).rejects.toThrow();
  }
  const alias = join(root, "alias");
  await symlink(dataDir, alias, process.platform === "win32" ? "junction" : "dir");
  await expect(
    captureSqliteBackup({ ...common(), dataDir: alias, destinationParent: backups }),
  ).rejects.toThrow();
  await repo.setControl({ stopped: false });
  await expect(capture()).rejects.toThrow();
  expect(await readdir(backups)).toEqual([]);
});

it("runs capture and restore in bounded offline workers without inheriting Node injection options", async () => {
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--synthetic-invalid-node-option";
  try {
    const captured = await runOfflineBackup({
      operation: "capture",
      input: { ...common(), dataDir, destinationParent: backups },
    });
    if (!("archivePath" in captured)) throw new Error("Expected capture response");
    const restored = await runOfflineBackup({
      operation: "restore",
      input: { ...common(), archivePath: captured.archivePath, destinationParent: restores },
    });
    expect(restored).toMatchObject({ restoreBlocked: true, files: 3 });
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
}, 30000);

it("kills a timed-out worker and removes only its generated staging directory", async () => {
  const sentinel = join(backups, "preserve.txt");
  await writeFile(sentinel, "synthetic-sentinel");
  await expect(
    runOfflineBackup(
      { operation: "capture", input: { ...common(), dataDir, destinationParent: backups } },
      1,
    ),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  expect(await readdir(backups)).toEqual(["preserve.txt"]);
  expect(await readFile(sentinel, "utf8")).toBe("synthetic-sentinel");
  expect((await repo.getControl()).stopped).toBe(true);
});

it("uses the offline command with an explicit private config and never prints either key", async () => {
  const execute = promisify(execFile),
    configPath = join(root, "synthetic.env");
  await writeFile(
    configPath,
    [
      "AUTOPILOT_PROFILE=local",
      `AUTOPILOT_DATA_DIR=${dataDir.replaceAll("\\", "/")}`,
      `AUTOPILOT_OWNER_ID=${ownerId}`,
      `AUTOPILOT_OWNER_TOKEN=${"synthetic-owner-token-".repeat(3)}`,
      `AUTOPILOT_VAULT_KEY=${vaultKey}`,
      `AUTOPILOT_BACKUP_KEY=${backupKey}`,
    ].join("\n"),
  );
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|PATH|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(
        key,
      ),
    ),
  );
  const argumentsFor = (operation: string, destination: string) => [
    "--import",
    "tsx",
    "scripts/backup.ts",
    operation,
    "--config",
    configPath,
    "--destination",
    destination,
    "--confirm-offline",
    "--confirm-protected-destination",
  ];
  const options = { env: environment, timeout: 30000, maxBuffer: 65536 };
  const captured = await execute(process.execPath, argumentsFor("capture", backups), options);
  expect(captured.stderr).toBe("");
  expect(captured.stdout).not.toContain(backupKey);
  expect(captured.stdout).not.toContain(vaultKey);
  const archivePath = JSON.parse(captured.stdout).archivePath;
  const restored = await execute(
    process.execPath,
    [...argumentsFor("restore", restores), "--archive", archivePath],
    options,
  );
  expect(JSON.parse(restored.stdout)).toMatchObject({ restoreBlocked: true, files: 3 });
  expect(restored.stderr).toBe("");
  expect(restored.stdout).not.toContain(backupKey);
  expect(restored.stdout).not.toContain(vaultKey);
}, 30000);

async function rewriteArchive(
  archive: string,
  edit: (entries: Array<{ name: string; bytes: Buffer }>) => void,
) {
  const zipPath = join(root, "editable.zip");
  await new BackupArchiveCipher(ownerId, backupKey).transform(archive, zipPath, true);
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true, autoClose: false });
  const entries: Array<{ name: string; bytes: Buffer }> = [];
  try {
    for await (const entry of zip.eachEntry()) {
      const chunks = [];
      for await (const chunk of await zip.openReadStreamPromise(entry))
        chunks.push(Buffer.from(chunk));
      entries.push({ name: entry.fileName, bytes: Buffer.concat(chunks) });
    }
  } finally {
    zip.close();
  }
  await rm(zipPath);
  edit(entries);
  const output = new ZipFile(),
    modified = join(root, "modified.zip"),
    encrypted = join(root, "modified.ocb");
  for (const entry of entries)
    output.addBuffer(entry.bytes, entry.name, { compress: false, mode: 0o100600 });
  const transfer = pipeline(output.outputStream, createWriteStream(modified, { flags: "wx" }));
  output.end();
  await transfer;
  await new BackupArchiveCipher(ownerId, backupKey).transform(modified, encrypted, false);
  await rm(modified);
  return encrypted;
}

it("rejects authenticated archives with missing/duplicate entries, invalid paths, identities or inventory omissions", async () => {
  const { archivePath } = await capture();
  const edits: Array<(entries: Array<{ name: string; bytes: Buffer }>) => void> = [
    (entries) => {
      const database = entries.find((entry) => entry.name === "opencareers.sqlite"),
        first = entries[0];
      if (!database || !first) throw new Error("Expected synthetic database and manifest");
      database.bytes.fill(0, 0, 16);
      const manifest = JSON.parse(first.bytes.toString());
      const file = manifest.files.find((entry: { kind: string }) => entry.kind === "database");
      file.sha256 = file.storedSha256 = digest(database.bytes);
      first.bytes = Buffer.from(JSON.stringify(manifest));
    },
    (entries) => {
      entries.pop();
    },
    (entries) => {
      const value = entries.at(-1);
      if (value) entries.push(value);
    },
    (entries) => {
      const first = entries[0];
      if (first) {
        const manifest = JSON.parse(first.bytes.toString());
        manifest.files[1].path = "../outside";
        first.bytes = Buffer.from(JSON.stringify(manifest));
      }
    },
    (entries) => {
      const first = entries[0];
      if (first) {
        const manifest = JSON.parse(first.bytes.toString());
        manifest.files[1].storedSha256 = "0".repeat(64);
        first.bytes = Buffer.from(JSON.stringify(manifest));
      }
    },
    (entries) => {
      const first = entries[0];
      if (first) {
        const manifest = JSON.parse(first.bytes.toString());
        const removed = manifest.files.pop();
        first.bytes = Buffer.from(JSON.stringify(manifest));
        const index = entries.findIndex((entry) => entry.name === removed.path);
        entries.splice(index, 1);
      }
    },
  ];
  for (const edit of edits) {
    const path = await rewriteArchive(archivePath, edit);
    await expect(restore(path)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(await readdir(restores)).toEqual([]);
    await rm(path);
  }
});
