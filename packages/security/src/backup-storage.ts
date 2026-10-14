import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { DomainError } from "../../contracts/src/index.js";

const MAGIC = Buffer.from("OCBACK01", "ascii");
const HEADER_BYTES = 20;
const TAG_BYTES = 16;
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;

// A backup key is separately recoverable; neither it nor the vault key is archived.
export class BackupArchiveCipher {
  private readonly key: Buffer;
  private readonly aad: Buffer;
  constructor(ownerId: string, encodedKey: string) {
    const key = Buffer.from(encodedKey, "base64");
    if (
      !ownerId ||
      ownerId.length > 180 ||
      key.length !== 32 ||
      key.toString("base64") !== encodedKey
    )
      throw new DomainError("CONFIG_INVALID", "Backup owner or key is invalid.");
    this.key = Buffer.from(hkdfSync("sha256", key, "OpenCareers", "backup-archive/v1", 32));
    key.fill(0);
    this.aad = Buffer.from(JSON.stringify({ format: "opencareers-backup/v1", ownerId }));
  }

  async transform(source: string, destination: string, decrypt: boolean) {
    let created = false;
    const input = await open(source, "r");
    try {
      const stat = await input.stat();
      if (!stat.isFile() || stat.size > MAX_BACKUP_BYTES || stat.size < (decrypt ? 37 : 1))
        throw new Error("Invalid bounded archive size");
      const header = decrypt ? Buffer.alloc(HEADER_BYTES) : Buffer.concat([MAGIC, randomBytes(12)]);
      const tag = Buffer.alloc(TAG_BYTES);
      if (decrypt) {
        if (
          (await input.read(header, 0, HEADER_BYTES, 0)).bytesRead !== HEADER_BYTES ||
          !header.subarray(0, 8).equals(MAGIC)
        )
          throw new Error("Invalid backup format");
        if ((await input.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES)).bytesRead !== TAG_BYTES)
          throw new Error("Missing backup authentication");
      }
      const output = await open(destination, "wx", 0o600);
      created = true;
      try {
        if (!decrypt) await output.writeFile(header);
        const nonce = header.subarray(8);
        const cipher = decrypt
          ? createDecipheriv("aes-256-gcm", this.key, nonce, { authTagLength: TAG_BYTES })
          : createCipheriv("aes-256-gcm", this.key, nonce, { authTagLength: TAG_BYTES });
        cipher.setAAD(this.aad);
        if ("setAuthTag" in cipher) cipher.setAuthTag(tag);
        const buffer = Buffer.alloc(64 * 1024),
          started = performance.now();
        const end = stat.size - (decrypt ? TAG_BYTES : 0);
        let position = decrypt ? HEADER_BYTES : 0;
        while (position < end) {
          if (performance.now() - started > 120000) throw new Error("Archive transfer timed out");
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, end - position),
            position,
          );
          if (!bytesRead) throw new Error("Archive input truncated during transfer");
          await output.writeFile(cipher.update(buffer.subarray(0, bytesRead)));
          position += bytesRead;
        }
        await output.writeFile(cipher.final());
        if ("getAuthTag" in cipher) await output.writeFile(cipher.getAuthTag());
        const after = await input.stat();
        if (
          after.size !== stat.size ||
          after.mtimeMs !== stat.mtimeMs ||
          after.ctimeMs !== stat.ctimeMs
        )
          throw new Error("Archive input changed");
        if ((await output.stat()).size > MAX_BACKUP_BYTES)
          throw new Error("Archive output too large");
        await output.sync();
      } finally {
        await output.close();
      }
    } catch {
      if (created) await rm(destination, { force: true }).catch(() => {});
      throw new DomainError(
        "STORAGE_UNAVAILABLE",
        "Backup archive encryption or authentication failed.",
      );
    } finally {
      await input.close();
    }
  }
}
