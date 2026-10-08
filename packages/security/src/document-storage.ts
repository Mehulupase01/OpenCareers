import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import type { Config } from "../../config/src/index.js";
import { DomainError } from "../../contracts/src/index.js";

const MAGIC = Buffer.from("OCDOC01\0", "ascii");
const HEADER_BYTES = 40;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_STORED_DOCUMENT_BYTES = MAX_DOCUMENT_BYTES + HEADER_BYTES;
type Purpose = "candidate_source" | "document_artifact";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// The authenticated format binds plaintext identity, not a mutable filesystem path.
export class DocumentStorage {
  private readonly key: Buffer | undefined;
  constructor(
    private readonly ownerId: string,
    private readonly purpose: Purpose,
    private readonly encrypted: boolean,
    encodedKey?: string,
  ) {
    if (!ownerId || ownerId.length > 180)
      throw new DomainError("CONFIG_INVALID", "Invalid document owner.");
    if (encodedKey) {
      const master = Buffer.from(encodedKey, "base64");
      if (master.length !== 32 || master.toString("base64") !== encodedKey)
        throw new DomainError("CONFIG_INVALID", "Document key must be canonical 256-bit base64.");
      this.key = Buffer.from(hkdfSync("sha256", master, "OpenCareers", "document-storage/v1", 32));
      master.fill(0);
    }
  }

  static fromConfig(config: Pick<Config, "profile" | "ownerId" | "vaultKey">, purpose: Purpose) {
    return new DocumentStorage(config.ownerId, purpose, config.profile !== "demo", config.vaultKey);
  }

  assertReady() {
    if (this.encrypted && !this.key)
      throw new DomainError("CONFIG_INVALID", "Private document storage requires a vault key.");
  }

  private aad(sha256: string, bytes: number) {
    if (!/^[a-f0-9]{64}$/.test(sha256) || bytes < 1 || bytes > MAX_DOCUMENT_BYTES)
      throw new DomainError("STORAGE_UNAVAILABLE", "Invalid document identity or size.");
    return Buffer.from(
      JSON.stringify({ version: 1, ownerId: this.ownerId, purpose: this.purpose, sha256, bytes }),
    );
  }

  encode(plaintext: Buffer): Buffer {
    this.assertReady();
    const aad = this.aad(digest(plaintext), plaintext.length);
    if (!this.encrypted) return Buffer.from(plaintext);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key as Buffer, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const header = Buffer.alloc(HEADER_BYTES);
    MAGIC.copy(header);
    header.writeUInt32BE(plaintext.length, 8);
    nonce.copy(header, 12);
    cipher.getAuthTag().copy(header, 24);
    return Buffer.concat([header, ciphertext]);
  }

  decode(stored: Buffer, expectedSha256: string): Buffer {
    this.assertReady();
    let plaintext: Buffer;
    if (!this.encrypted) {
      this.aad(expectedSha256, stored.length);
      plaintext = stored;
    } else {
      if (!stored.subarray(0, 8).equals(MAGIC))
        throw new DomainError(
          "CONFIG_INVALID",
          "Legacy plaintext document requires an explicit offline migration.",
        );
      if (stored.length < HEADER_BYTES + 1 || stored.length > HEADER_BYTES + MAX_DOCUMENT_BYTES)
        throw new DomainError("STORAGE_UNAVAILABLE", "Invalid encrypted document size.");
      const bytes = stored.readUInt32BE(8);
      const aad = this.aad(expectedSha256, bytes);
      if (stored.length !== HEADER_BYTES + bytes)
        throw new DomainError("STORAGE_UNAVAILABLE", "Encrypted document length mismatch.");
      try {
        const cipher = createDecipheriv(
          "aes-256-gcm",
          this.key as Buffer,
          stored.subarray(12, 24),
          { authTagLength: 16 },
        );
        cipher.setAAD(aad);
        cipher.setAuthTag(stored.subarray(24, 40));
        plaintext = Buffer.concat([cipher.update(stored.subarray(40)), cipher.final()]);
      } catch {
        throw new DomainError("STORAGE_UNAVAILABLE", "Document authentication failed.");
      }
    }
    if (digest(plaintext) !== expectedSha256)
      throw new DomainError("STORAGE_UNAVAILABLE", "Document hash verification failed.");
    return plaintext;
  }
}
