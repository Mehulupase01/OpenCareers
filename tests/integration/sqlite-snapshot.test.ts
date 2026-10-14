import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type Database, openSqlite } from "../../packages/persistence/src/database.js";
import { migrate, migrations } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import {
  assertNoRestoreReplay,
  RestoreRepository,
} from "../../packages/persistence/src/restore-repository.js";
import { captureQuiescentSqliteSnapshot } from "../../packages/persistence/src/sqlite-snapshot.js";

let root: string, path: string, db: Database, repository: Repository;
const ownerId = "synthetic-snapshot-owner";
const input = () => ({
  databasePath: path,
  destinationParent: root,
  ownerId,
  allWritersStopped: true as const,
  protectedDestinationReviewed: true as const,
});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-snapshot-test-")));
  path = join(root, "source.sqlite");
  db = await openSqlite(path);
  await migrate(db);
  repository = new Repository(db, ownerId);
  await repository.initialize();
  await repository.setControl({ stopped: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
it("preserves an older supported schema without applying newer migrations", async () => {
  const oldPath = join(root, "old.sqlite");
  const old = await openSqlite(oldPath);
  try {
    await migrate(old, 1);
    const repo = new Repository(old, ownerId);
    await repo.initialize();
    await repo.setControl({ stopped: true });
    const result = await captureQuiescentSqliteSnapshot({ ...input(), databasePath: oldPath });
    expect(result.manifest.migrationVersion).toBe(1);
    expect((await old.query("SELECT COUNT(*) AS n FROM schema_migrations"))[0]?.n).toBe(1);
  } finally {
    await old.close();
  }
});
it("refuses a concurrent source write and removes its incomplete generated snapshot", async () => {
  const original = BetterSqlite3.prototype.backup;
  const writer = new BetterSqlite3(path);
  let changed = false;
  vi.spyOn(BetterSqlite3.prototype, "backup").mockImplementationOnce(function (
    this: BetterSqlite3.Database,
    destination,
    options,
  ) {
    return original.call(this, destination, {
      ...options,
      progress: (progress) => {
        if (!changed) {
          changed = true;
          writer.prepare("UPDATE controls SET revision=revision+1 WHERE owner_id=?").run(ownerId);
        }
        return options?.progress?.(progress) ?? 100;
      },
    });
  });
  try {
    await expect(captureQuiescentSqliteSnapshot(input())).rejects.toMatchObject({
      code: "REVISION_STALE",
    });
    expect(changed).toBe(true);
    expect((await readdir(root)).some((name) => name.startsWith("opencareers-snapshot-"))).toBe(
      false,
    );
  } finally {
    writer.close();
  }
});
it("captures WAL-only committed changes without migrating or writing the source and verifies the copy", async () => {
  await db.query(
    "INSERT INTO audit_events(id,owner_id,aggregate_id,action,revision,actor,correlation_id,payload,occurred_at) VALUES($1,$2,'snapshot','synthetic',1,'fixture','fixture','{}',$3)",
    ["wal-only-event", ownerId, new Date().toISOString()],
  );
  expect((await readFile(`${path}-wal`)).length).toBeGreaterThan(0);
  const sourceBefore = await readFile(path);
  const walBefore = await readFile(`${path}-wal`);
  const result = await captureQuiescentSqliteSnapshot(input());
  expect(await readFile(path)).toEqual(sourceBefore);
  expect(await readFile(`${path}-wal`)).toEqual(walBefore);
  const copy = new BetterSqlite3(result.snapshotPath, { readonly: true, fileMustExist: true });
  try {
    expect(copy.prepare("SELECT id FROM audit_events WHERE id='wal-only-event'").get()).toEqual({
      id: "wal-only-event",
    });
    expect(copy.pragma("quick_check", { simple: true })).toBe("ok");
    expect(copy.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({
      n: migrations.length,
    });
  } finally {
    copy.close();
  }
  const bytes = await readFile(result.snapshotPath);
  expect(result.manifest).toMatchObject({
    databaseSha256: createHash("sha256").update(bytes).digest("hex"),
    databaseBytes: bytes.length,
    encrypted: false,
    productionBackupAccepted: false,
    scope: "quiescent_sqlite_database_only",
  });
  expect(
    JSON.parse(await readFile(join(result.directory, "database-snapshot.json"), "utf8")),
  ).toEqual(result.manifest);
  expect((await captureQuiescentSqliteSnapshot(input())).directory).not.toBe(result.directory);
});
it("restores captured identity into a separate offline target with replay quarantine", async () => {
  const job = {
    id: "snapshot-job",
    employerId: "synthetic-employer",
    requisitionId: "snapshot-req",
    title: "Synthetic engineer",
    company: "Synthetic employer",
    location: "NL",
    url: "https://jobs.synthetic.test/snapshot",
    description: "Synthetic snapshot fixture.",
    source: "fixture",
    synthetic: true,
  };
  await repository.putJob(job);
  const app = await repository.createApplication(job.id, "synthetic-candidate");
  await repository.enqueue({
    type: "submit",
    domain: "mock-ats",
    applicationId: app.id,
    dedupeKey: "snapshot-submit",
  });
  const snapshot = await captureQuiescentSqliteSnapshot(input());
  const originalBytes = await readFile(snapshot.snapshotPath);
  const target = join(root, "restored.sqlite");
  await copyFile(snapshot.snapshotPath, target);
  const restored = await openSqlite(target);
  try {
    const repo = new Repository(restored, ownerId);
    const recovery = new RestoreRepository(restored, ownerId);
    await recovery.block(snapshot.manifest.databaseSha256);
    expect(
      (await restored.query("SELECT id,job_id FROM applications WHERE owner_id=$1", [ownerId]))[0],
    ).toEqual({ id: app.id, job_id: job.id });
    await repo.setControl({
      stopped: false,
      discoveryPaused: false,
      preparationPaused: false,
      submissionsPaused: false,
    });
    expect((await repo.getControl()).restoreBlocked).toBe(true);
    expect(await repo.claim("restored-worker", ["submit"])).toBeNull();
    await expect(assertNoRestoreReplay(restored, ownerId, app.id)).rejects.toMatchObject({
      code: "POLICY_REVOKED",
    });
    expect(
      (
        await restored.query("SELECT disposition FROM restore_reviews WHERE owner_id=$1", [ownerId])
      )[0]?.disposition,
    ).toBe("pending");
  } finally {
    await restored.close();
  }
  expect(await readFile(snapshot.snapshotPath)).toEqual(originalBytes);
});
it("requires explicit stopped-runtime and destination acknowledgements without allocating a snapshot", async () => {
  const before = await readdir(root);
  await expect(
    captureQuiescentSqliteSnapshot({ ...input(), allWritersStopped: false } as never),
  ).rejects.toThrow();
  await expect(
    captureQuiescentSqliteSnapshot({ ...input(), protectedDestinationReviewed: false } as never),
  ).rejects.toThrow();
  await repository.setControl({ stopped: false });
  await expect(captureQuiescentSqliteSnapshot(input())).rejects.toMatchObject({
    code: "POLICY_REVOKED",
  });
  expect(await readdir(root)).toEqual(before);
});
it("refuses recent workers and active task leases", async () => {
  await repository.heartbeat("synthetic-worker", "scheduler");
  await expect(captureQuiescentSqliteSnapshot(input())).rejects.toMatchObject({
    code: "STATE_INVALID",
  });
  await db.query("DELETE FROM workers WHERE owner_id=$1", [ownerId]);
  await repository.setControl({ stopped: false });
  await repository.enqueue({ type: "prepare", domain: "fixture", dedupeKey: "snapshot-task" });
  expect(await repository.claim("snapshot-worker", ["prepare"])).not.toBeNull();
  await repository.setControl({ stopped: true });
  await expect(captureQuiescentSqliteSnapshot(input())).rejects.toMatchObject({
    code: "STATE_INVALID",
  });
});
it("rejects foreign owners and modified migration history", async () => {
  await expect(
    captureQuiescentSqliteSnapshot({ ...input(), ownerId: "foreign" }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await db.query("UPDATE schema_migrations SET checksum='changed' WHERE version=1");
  await expect(captureQuiescentSqliteSnapshot(input())).rejects.toMatchObject({
    code: "MIGRATION_UNSUPPORTED",
  });
});
it("refuses redirected parents and missing sources rather than bootstrapping data", async () => {
  const alias = join(root, "redirected");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  await expect(
    captureQuiescentSqliteSnapshot({ ...input(), destinationParent: alias }),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  await expect(
    captureQuiescentSqliteSnapshot({ ...input(), databasePath: join(root, "missing.sqlite") }),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  expect((await readdir(root)).includes("missing.sqlite")).toBe(false);
});
