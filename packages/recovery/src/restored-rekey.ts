import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { openSqlite } from "../../persistence/src/database.js";
import { Repository } from "../../persistence/src/repository.js";
import { DocumentStorage, MAX_STORED_DOCUMENT_BYTES } from "../../security/src/document-storage.js";
import { VaultCipher, vaultBindingSchema, vaultEnvelopeSchema } from "../../security/src/vault.js";

type DocumentIdentity = {
  kind: "candidate_source" | "document_artifact";
  path: string;
  sha256: string;
  bytes: number;
};

class RestoredVaultRepository extends Repository {
  async rotate(oldKey: string, replacementKey: string, documents: number) {
    const oldVault = new VaultCipher(oldKey),
      newVault = new VaultCipher(replacementKey);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const control = await this.readControl(tx);
      if (!control.stopped) throw new Error("Offline rekey requires stopped data");
      const rows = await tx.query(
        "SELECT id,purpose,key_version,envelope FROM vault_secrets WHERE owner_id=$1 LIMIT 5001",
        [this.ownerId],
      );
      if (rows.length > 5000) throw new Error("Rekey secret count exceeds bound");
      for (const row of rows) {
        const version = Number(row.key_version);
        if (!Number.isSafeInteger(version) || version < 1 || version >= 2147483647)
          throw new Error("Unsupported secret key version");
        const binding = vaultBindingSchema.parse({
          ownerId: this.ownerId,
          secretId: row.id,
          purpose: row.purpose,
          keyVersion: version,
        });
        const clear = oldVault.open(
          vaultEnvelopeSchema.parse(JSON.parse(String(row.envelope))),
          binding,
        );
        try {
          const next = { ...binding, keyVersion: version + 1 },
            envelope = newVault.seal(clear, next);
          const verified = newVault.open(envelope, next);
          try {
            if (!verified.equals(clear)) throw new Error("Rekey verification failed");
          } finally {
            verified.fill(0);
          }
          await tx.query(
            "UPDATE vault_secrets SET envelope=$1,key_version=$2,rotated_at=$3 WHERE owner_id=$4 AND id=$5",
            [JSON.stringify(envelope), version + 1, this.now(), this.ownerId, String(row.id)],
          );
        } finally {
          clear.fill(0);
        }
      }
      await this.audit(
        tx,
        randomUUID(),
        "security.restored_storage_rekeyed",
        1,
        { secrets: rows.length, documents },
        "system:offline-rekey",
      );
      return rows.length;
    });
  }
}

// Only called on the fresh, unpublished extraction owned by restoreSqliteBackup.
export async function rekeyRestoredData(
  root: string,
  ownerId: string,
  oldKey: string,
  replacementKey: string,
  documents: DocumentIdentity[],
) {
  if (oldKey === replacementKey) throw new Error("Replacement vault key must differ");
  new VaultCipher(replacementKey);
  const physical = await realpath(root);
  const same = (left: string, right: string) =>
    process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (!same(resolve(root), physical) || !(await lstat(root)).isDirectory())
    throw new Error("Rekey extraction is redirected");
  if (
    basename(physical) !== "files" ||
    !basename(dirname(physical)).startsWith("opencareers-restore-") ||
    documents.length > 5000
  )
    throw new Error("Rekey requires an unpublished restore extraction");
  const inspected = new BetterSqlite3(join(physical, "opencareers.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const owners = inspected.prepare("SELECT id FROM owners LIMIT 2").all() as Array<{
      id: string;
    }>;
    const control = inspected.prepare("SELECT data FROM controls WHERE owner_id=?").get(ownerId) as
      | { data: string }
      | undefined;
    if (
      owners.length !== 1 ||
      owners[0]?.id !== ownerId ||
      !control ||
      JSON.parse(control.data).stopped !== true
    )
      throw new Error("Rekey requires its stopped owner");
  } finally {
    inspected.close();
  }
  const ownerHash = createHash("sha256").update(ownerId).digest("hex");
  for (const entry of documents) {
    const expected =
      entry.kind === "candidate_source"
        ? `candidate-sources/${ownerHash}/${entry.sha256}`
        : `artifacts/sha256/${entry.sha256.slice(0, 2)}/${entry.sha256}`;
    if (
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !["candidate_source", "document_artifact"].includes(entry.kind) ||
      entry.path !== expected
    )
      throw new Error("Invalid rekey document identity");
    const path = join(physical, ...entry.path.split("/")),
      info = await lstat(path);
    if (
      !same(path, await realpath(path)) ||
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > MAX_STORED_DOCUMENT_BYTES
    )
      throw new Error("Invalid rekey document path");
    const oldStorage = new DocumentStorage(ownerId, entry.kind, true, oldKey),
      nextStorage = new DocumentStorage(ownerId, entry.kind, true, replacementKey);
    const clear = oldStorage.decode(await readFile(path), entry.sha256);
    try {
      if (clear.length !== entry.bytes) throw new Error("Invalid rekey document size");
      const encoded = nextStorage.encode(clear),
        verified = nextStorage.decode(encoded, entry.sha256);
      try {
        if (!verified.equals(clear) || encoded.length !== info.size)
          throw new Error("Rekey identity changed");
      } finally {
        verified.fill(0);
      }
      const file = await open(path, "r+");
      try {
        await file.writeFile(encoded);
        await file.sync();
      } finally {
        await file.close();
      }
    } finally {
      clear.fill(0);
    }
  }
  const db = await openSqlite(join(physical, "opencareers.sqlite"));
  try {
    return await new RestoredVaultRepository(db, ownerId).rotate(
      oldKey,
      replacementKey,
      documents.length,
    );
  } finally {
    await db.close();
  }
}
