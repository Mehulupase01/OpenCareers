import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Config } from "../../config/src/index.js";
import { DomainError } from "../../contracts/src/index.js";
import { Repository } from "../../persistence/src/repository.js";
import { DocumentStorage, MAX_STORED_DOCUMENT_BYTES } from "../../security/src/document-storage.js";

const samePath = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

export class DocumentEncryptionMigration extends Repository {
  async encrypt(
    config: Pick<Config, "profile" | "dataDir" | "vaultKey">,
    confirmations: { offline: boolean; backup: boolean },
  ) {
    if (config.profile === "demo" || !confirmations.offline || !confirmations.backup)
      throw new DomainError(
        "CONFIG_INVALID",
        "Private document migration requires offline and recoverable-backup confirmation.",
      );
    const policy = { ...config, ownerId: this.ownerId };
    const source = DocumentStorage.fromConfig(policy, "candidate_source");
    const artifact = DocumentStorage.fromConfig(policy, "document_artifact");
    source.assertReady();
    const active = await this.db.query(
      "SELECT id FROM workers WHERE owner_id=$1 AND last_seen_at>$2 LIMIT 1",
      [this.ownerId, new Date(this.clock().getTime() - 120000).toISOString()],
    );
    if (active.length)
      throw new DomainError(
        "STATE_INVALID",
        "Shut down all workers and wait for their heartbeats to expire before migration.",
      );
    await this.setControl({ stopped: true, submissionsPaused: true }, `owner:${this.ownerId}`);
    const root = resolve(config.dataDir);
    if (!samePath(root, await realpath(root)))
      throw new DomainError(
        "STORAGE_UNAVAILABLE",
        "Document migration root must not be redirected.",
      );
    const ownerHash = createHash("sha256").update(this.ownerId).digest("hex");
    const rows = [
      ...(
        await this.db.query(
          "SELECT sha256,storage_key,bytes FROM candidate_sources WHERE owner_id=$1",
          [this.ownerId],
        )
      ).map((row) => ({ row, codec: source, purpose: "candidate_source" as const })),
      ...(
        await this.db.query("SELECT sha256,storage_key,bytes FROM artifacts WHERE owner_id=$1", [
          this.ownerId,
        ])
      ).map((row) => ({ row, codec: artifact, purpose: "document_artifact" as const })),
    ];
    const entries = rows.map(({ row, codec, purpose }) => {
      const sha256 = String(row.sha256);
      if (!/^[a-f0-9]{64}$/.test(sha256))
        throw new DomainError("STORAGE_UNAVAILABLE", "Invalid migration document identity.");
      const expected =
        purpose === "candidate_source"
          ? `candidate-sources/${ownerHash}/${sha256}`
          : `sha256/${sha256.slice(0, 2)}/${sha256}`;
      if (String(row.storage_key).replaceAll("\\", "/") !== expected)
        throw new DomainError(
          "STORAGE_UNAVAILABLE",
          "Document storage key does not match the owner and checksum.",
        );
      return {
        codec,
        purpose,
        sha256,
        bytes: Number(row.bytes),
        target: join(
          root,
          ...(purpose === "candidate_source" ? [] : ["artifacts"]),
          ...expected.split("/"),
        ),
      };
    });
    const read = async (entry: (typeof entries)[number]) => {
      let directory = dirname(entry.target);
      for (;;) {
        const metadata = await lstat(directory);
        if (
          !metadata.isDirectory() ||
          metadata.isSymbolicLink() ||
          !samePath(directory, await realpath(directory))
        )
          throw new DomainError(
            "STORAGE_UNAVAILABLE",
            "Migration document directories must not be redirected.",
          );
        if (samePath(directory, root)) break;
        directory = dirname(directory);
      }
      const metadata = await lstat(entry.target);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size > MAX_STORED_DOCUMENT_BYTES
      )
        throw new DomainError("STORAGE_UNAVAILABLE", "Invalid migration document file.");
      const stored = await readFile(entry.target);
      const encrypted = stored.subarray(0, 8).toString("ascii") === "OCDOC01\0";
      const bytes = encrypted
        ? entry.codec.decode(stored, entry.sha256)
        : new DocumentStorage(this.ownerId, entry.purpose, false).decode(stored, entry.sha256);
      if (bytes.length !== entry.bytes)
        throw new DomainError(
          "STORAGE_UNAVAILABLE",
          "Migration document metadata length mismatch.",
        );
      return { bytes, encrypted };
    };
    // Preflight the whole inventory, then revalidate each file immediately before replacement.
    for (const entry of entries) await read(entry);
    let encrypted = 0;
    let alreadyEncrypted = 0;
    for (const entry of entries) {
      const original = await read(entry);
      if (original.encrypted) {
        alreadyEncrypted++;
        continue;
      }
      const sealed = entry.codec.encode(original.bytes);
      entry.codec.decode(sealed, entry.sha256);
      const pending = `${entry.target}.${randomUUID()}.encrypting`;
      try {
        const file = await open(pending, "wx", 0o600);
        try {
          await file.writeFile(sealed);
          await file.sync();
        } finally {
          await file.close();
        }
        await read(entry);
        await rename(pending, entry.target);
        await read(entry);
        encrypted++;
      } finally {
        await rm(pending, { force: true });
      }
    }
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.audit(
        tx,
        this.ownerId,
        "documents.encryption_migrated",
        1,
        { encrypted, alreadyEncrypted },
        `owner:${this.ownerId}`,
      );
    });
    return { encrypted, alreadyEncrypted, processingStopped: true };
  }
}
