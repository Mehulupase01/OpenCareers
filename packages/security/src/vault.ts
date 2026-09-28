import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const vaultBindingSchema = z
  .object({
    ownerId: z.string().min(1).max(180),
    secretId: z.string().uuid(),
    purpose: z.enum(["employer_password", "browser_storage", "oauth_token"]),
    keyVersion: z.number().int().positive(),
  })
  .strict();
export type VaultBinding = z.infer<typeof vaultBindingSchema>;

export const vaultEnvelopeSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    keyVersion: z.number().int().positive(),
    nonce: base64,
    ciphertext: base64,
    tag: base64,
    aadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type VaultEnvelope = z.infer<typeof vaultEnvelopeSchema>;

function canonicalBinding(input: VaultBinding): Buffer {
  const binding = vaultBindingSchema.parse(input);
  return Buffer.from(
    JSON.stringify({
      keyVersion: binding.keyVersion,
      ownerId: binding.ownerId,
      purpose: binding.purpose,
      secretId: binding.secretId,
    }),
    "utf8",
  );
}

export class VaultCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32 || key.toString("base64") !== encodedKey)
      throw new DomainError("CONFIG_INVALID", "Vault key is not canonical 256-bit base64.");
    this.key = Buffer.from(key);
    key.fill(0);
  }

  seal(plaintext: Uint8Array, bindingInput: VaultBinding): VaultEnvelope {
    if (!plaintext.byteLength || plaintext.byteLength > 64 * 1024)
      throw new DomainError("CONFIG_INVALID", "Vault plaintext size is invalid.");
    const binding = vaultBindingSchema.parse(bindingInput);
    const aad = canonicalBinding(binding);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return vaultEnvelopeSchema.parse({
      algorithm: "aes-256-gcm",
      keyVersion: binding.keyVersion,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      aadSha256: createHash("sha256").update(aad).digest("hex"),
    });
  }

  open(envelopeInput: VaultEnvelope, bindingInput: VaultBinding): Buffer {
    const envelope = vaultEnvelopeSchema.parse(envelopeInput);
    const binding = vaultBindingSchema.parse(bindingInput);
    const aad = canonicalBinding(binding);
    if (
      envelope.keyVersion !== binding.keyVersion ||
      envelope.aadSha256 !== createHash("sha256").update(aad).digest("hex")
    )
      throw new DomainError("UNAUTHORIZED", "Vault binding does not match the secret.");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(envelope.nonce, "base64"),
        { authTagLength: 16 },
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
    } catch {
      throw new DomainError("UNAUTHORIZED", "Vault secret authentication failed.");
    }
  }
}
