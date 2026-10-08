import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CandidateImporter } from "../../packages/candidate/src/import.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { DocumentEncryptionMigration } from "../../packages/documents/src/encrypt-existing.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import { type Database, openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { DocumentStorage } from "../../packages/security/src/document-storage.js";
import { syntheticDocx } from "../helpers/document-fixtures.js";

describe("explicit offline document encryption upgrade", () => {
  let root: string;
  let db: Database;
  let migration: DocumentEncryptionMigration;
  let config: { profile: "local"; dataDir: string; vaultKey: string };
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-encryption-upgrade-")));
    db = await openSqlite(":memory:");
    await migrate(db);
    migration = new DocumentEncryptionMigration(db, "synthetic-owner");
    await migration.initialize();
    config = { profile: "local", dataDir: root, vaultKey: randomBytes(32).toString("base64") };
  });
  afterEach(async () => {
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  async function artifact(bytes = Buffer.from("%PDF-1.7 Synthetic letter")) {
    const store = new ArtifactStore(root);
    await store.initialize();
    const stored = await store.put(bytes);
    await db.query(
      "INSERT INTO artifacts(id,owner_id,sha256,storage_key,mime_type,bytes,created_at) VALUES($1,$2,$3,$4,'application/pdf',$5,$6)",
      [
        randomUUID(),
        migration.ownerId,
        stored.sha256,
        stored.storageKey,
        stored.bytes,
        new Date().toISOString(),
      ],
    );
    return {
      ...stored,
      path: join(root, "artifacts", ...stored.storageKey.split("/")),
      plaintext: bytes,
    };
  }

  it("encrypts source and artifact inventories, preserves all identities and resumes idempotently", async () => {
    const first = await artifact();
    const candidate = new CandidateRepository(db, migration.ownerId);
    await candidate.initialize();
    const sourceBytes = await syntheticDocx();
    const imported = await new CandidateImporter(candidate, root).import(
      sourceBytes,
      "synthetic.docx",
    );
    const source = (
      await db.query("SELECT storage_key FROM candidate_sources WHERE owner_id=$1", [
        migration.ownerId,
      ])
    )[0];
    expect(await migration.encrypt(config, { offline: true, backup: true })).toEqual({
      encrypted: 2,
      alreadyEncrypted: 0,
      processingStopped: true,
    });
    const protectedStore = new ArtifactStore(
      root,
      DocumentStorage.fromConfig({ ...config, ownerId: migration.ownerId }, "document_artifact"),
    );
    await protectedStore.initialize();
    expect(await protectedStore.read(first.storageKey, first.sha256)).toEqual(first.plaintext);
    expect((await readFile(first.path)).includes(first.plaintext)).toBe(false);
    const protectedSource = DocumentStorage.fromConfig(
      { ...config, ownerId: migration.ownerId },
      "candidate_source",
    );
    expect(
      protectedSource.decode(
        await readFile(join(root, String(source?.storage_key))),
        imported.sha256,
      ),
    ).toEqual(sourceBytes);
    expect(await migration.encrypt(config, { offline: true, backup: true })).toEqual({
      encrypted: 0,
      alreadyEncrypted: 2,
      processingStopped: true,
    });
    expect(await migration.getControl()).toMatchObject({ stopped: true, submissionsPaused: true });
    expect((await db.query("SELECT sha256,bytes FROM artifacts"))[0]).toMatchObject({
      sha256: first.sha256,
      bytes: first.bytes,
    });
    const audit = await db.query(
      "SELECT payload FROM audit_events WHERE action='documents.encryption_migrated'",
    );
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain("Synthetic letter");
  });

  it("requires explicit offline/backup confirmation and rejects an active worker before modifying controls", async () => {
    const first = await artifact();
    await expect(migration.encrypt(config, { offline: false, backup: true })).rejects.toThrow(
      "confirmation",
    );
    await expect(migration.encrypt(config, { offline: true, backup: false })).rejects.toThrow(
      "confirmation",
    );
    await expect(
      migration.encrypt({ ...config, vaultKey: undefined }, { offline: true, backup: true }),
    ).rejects.toThrow("vault key");
    await migration.heartbeat("synthetic-running-worker", "scheduler");
    await expect(migration.encrypt(config, { offline: true, backup: true })).rejects.toThrow(
      "Shut down all workers",
    );
    expect((await migration.getControl()).stopped).toBe(false);
    expect(await readFile(first.path)).toEqual(first.plaintext);
  });

  it("preflights every checksum before any replacement and leaves the failed upgrade stopped", async () => {
    const first = await artifact();
    const second = await artifact(Buffer.from("%PDF-1.7 Another synthetic letter"));
    await writeFile(second.path, "corrupt");
    await expect(migration.encrypt(config, { offline: true, backup: true })).rejects.toThrow(
      "hash verification failed",
    );
    expect(await readFile(first.path)).toEqual(first.plaintext);
    expect((await migration.getControl()).stopped).toBe(true);
  });

  it("rejects redirected directories, altered manifest keys and wrong-key restarts", async () => {
    const first = await artifact();
    await db.query("UPDATE artifacts SET storage_key='../escape'");
    await expect(migration.encrypt(config, { offline: true, backup: true })).rejects.toThrow(
      "storage key",
    );
    await db.query("UPDATE artifacts SET storage_key=$1", [first.storageKey]);
    await migration.encrypt(config, { offline: true, backup: true });
    const sealed = await readFile(first.path);
    await expect(
      migration.encrypt(
        { ...config, vaultKey: randomBytes(32).toString("base64") },
        { offline: true, backup: true },
      ),
    ).rejects.toThrow("authentication failed");
    expect(await readFile(first.path)).toEqual(sealed);
    const outside = join(root, "outside");
    await mkdir(outside);
    const redirected = join(root, "redirected");
    await symlink(root, redirected, process.platform === "win32" ? "junction" : "dir");
    await expect(
      migration.encrypt({ ...config, dataDir: redirected }, { offline: true, backup: true }),
    ).rejects.toThrow("must not be redirected");
  });
});
