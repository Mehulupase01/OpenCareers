import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DocumentStorage,
  MAX_DOCUMENT_BYTES,
} from "../../packages/security/src/document-storage.js";

const key = randomBytes(32).toString("base64");
const bytes = Buffer.from("%PDF-1.7 Synthetic private career facts");
const hash = createHash("sha256").update(bytes).digest("hex");
const encrypted = (
  owner = "synthetic-owner",
  purpose: "candidate_source" | "document_artifact" = "document_artifact",
  encodedKey = key,
) => new DocumentStorage(owner, purpose, true, encodedKey);

describe("authenticated document storage", () => {
  it("roundtrips non-deterministic ciphertext bound to plaintext checksums", () => {
    const codec = encrypted();
    const first = codec.encode(bytes);
    expect(first).not.toEqual(codec.encode(bytes));
    expect(first.includes(bytes)).toBe(false);
    expect(codec.decode(first, hash)).toEqual(bytes);
  });

  it("rejects another owner, purpose, key or expected checksum", () => {
    const sealed = encrypted().encode(bytes);
    for (const codec of [
      encrypted("other-owner"),
      encrypted("synthetic-owner", "candidate_source"),
      encrypted("synthetic-owner", "document_artifact", randomBytes(32).toString("base64")),
    ])
      expect(() => codec.decode(sealed, hash)).toThrow("authentication failed");
    expect(() => encrypted().decode(sealed, "0".repeat(64))).toThrow("authentication failed");
  });

  it("rejects mutations of every header field, ciphertext and appended/truncated data", () => {
    const codec = encrypted();
    const sealed = codec.encode(bytes);
    for (const index of [0, 8, 12, 24, 40, sealed.length - 1]) {
      const changed = Buffer.from(sealed);
      changed[index] = (changed[index] ?? 0) ^ 1;
      expect(() => codec.decode(changed, hash)).toThrow();
    }
    expect(() => codec.decode(sealed.subarray(0, -1), hash)).toThrow();
    expect(() => codec.decode(Buffer.concat([sealed, Buffer.from("x")]), hash)).toThrow();
  });

  it("fails closed for missing keys and legacy plaintext without preventing construction", () => {
    const unconfigured = new DocumentStorage("synthetic-owner", "document_artifact", true);
    expect(() => unconfigured.encode(bytes)).toThrow("requires a vault key");
    expect(() => unconfigured.decode(bytes, hash)).toThrow("requires a vault key");
    expect(() => encrypted().decode(bytes, hash)).toThrow("explicit offline migration");
    expect(() => encrypted("synthetic-owner", "document_artifact", "invalid")).toThrow();
  });

  it("enforces sizes and keeps synthetic fixture storage explicitly plaintext", () => {
    const plain = new DocumentStorage("synthetic-owner", "document_artifact", false);
    expect(plain.encode(bytes)).toEqual(bytes);
    expect(plain.decode(bytes, hash)).toEqual(bytes);
    expect(() => plain.decode(bytes, "0".repeat(64))).toThrow("hash verification failed");
    for (const size of [0, MAX_DOCUMENT_BYTES + 1])
      expect(() => encrypted().encode(Buffer.alloc(size))).toThrow();
    const maximum = Buffer.alloc(MAX_DOCUMENT_BYTES, 7);
    expect(
      encrypted()
        .decode(encrypted().encode(maximum), createHash("sha256").update(maximum).digest("hex"))
        .equals(maximum),
    ).toBe(true);
  });
});
