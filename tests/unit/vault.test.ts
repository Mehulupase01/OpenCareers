import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VaultCipher, type VaultEnvelope } from "../../packages/security/src/vault.js";

const key = Buffer.alloc(32, 11).toString("base64");
const binding = {
  ownerId: "owner-a",
  secretId: randomUUID(),
  purpose: "employer_password" as const,
  keyVersion: 1,
};

describe("authenticated secret vault", () => {
  it("round-trips a secret without embedding plaintext in the envelope", () => {
    const vault = new VaultCipher(key);
    const plaintext = Buffer.from("synthetic-password-never-log", "utf8");
    const envelope = vault.seal(plaintext, binding);
    expect(JSON.stringify(envelope)).not.toContain(plaintext.toString("utf8"));
    expect(vault.open(envelope, binding)).toEqual(plaintext);
  });

  it("rejects owner, purpose, version, ciphertext and tag changes", () => {
    const vault = new VaultCipher(key);
    const envelope = vault.seal(Buffer.from("synthetic-secret"), binding);
    for (const changedBinding of [
      { ...binding, ownerId: "owner-b" },
      { ...binding, purpose: "oauth_token" as const },
      { ...binding, keyVersion: 2 },
    ])
      expect(() => vault.open(envelope, changedBinding)).toThrow();
    for (const changedEnvelope of [
      { ...envelope, ciphertext: Buffer.from("changed").toString("base64") },
      { ...envelope, tag: Buffer.alloc(16, 3).toString("base64") },
    ] satisfies VaultEnvelope[])
      expect(() => vault.open(changedEnvelope, binding)).toThrow(/authentication failed/);
  });

  it("rejects weak keys and empty or oversized secrets", () => {
    expect(() => new VaultCipher(Buffer.alloc(16).toString("base64"))).toThrow(/256-bit/);
    const vault = new VaultCipher(key);
    expect(() => vault.seal(Buffer.alloc(0), binding)).toThrow(/size/);
    expect(() => vault.seal(Buffer.alloc(64 * 1024 + 1), binding)).toThrow(/size/);
  });
});
