import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../packages/config/src/index.js";
import {
  createArtifactStore,
  S3ArtifactStore,
} from "../../packages/documents/src/s3-artifact-store.js";
import { MAX_STORED_DOCUMENT_BYTES } from "../../packages/security/src/document-storage.js";

const key = randomBytes(32).toString("base64");
const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
function fixture() {
  const objects = new Map<string, Buffer>();
  const client = new S3Client({
    region: "synthetic",
    credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
  });
  const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
    if (command instanceof HeadBucketCommand) return {};
    if (!(command instanceof PutObjectCommand) && !(command instanceof GetObjectCommand))
      throw new Error("Unexpected fixture command.");
    const name = command.input.Key as string;
    if (command instanceof PutObjectCommand) {
      expect(command.input.IfNoneMatch).toBe("*");
      if (objects.has(name)) throw { $metadata: { httpStatusCode: 412 } };
      const bytes = Buffer.from(command.input.Body as Buffer);
      expect(command.input.ChecksumSHA256).toBe(
        createHash("sha256").update(bytes).digest("base64"),
      );
      objects.set(name, bytes);
      return {};
    }
    expect(command).toBeInstanceOf(GetObjectCommand);
    const bytes = objects.get(name);
    if (!bytes) throw { $metadata: { httpStatusCode: 404 } };
    return { Body: Readable.from([bytes]), ContentLength: bytes.length };
  });
  const store = new S3ArtifactStore(client, "synthetic-artifacts", "synthetic-owner", key);
  return { store, client, objects, send };
}

describe("encrypted S3 artifact boundary", () => {
  it("refuses readiness when the configured bucket is inaccessible", async () => {
    const { store, send } = fixture();
    send.mockRejectedValueOnce(new Error("synthetic provider authorization detail"));
    await expect(store.initialize()).rejects.toThrow("Remote artifact storage failed.");
  });
  it("verifies encrypted concurrent writes without overwriting the winning object", async () => {
    const { store, objects } = fixture();
    await store.initialize();
    const bytes = Buffer.from("Synthetic private letter bytes");
    const [first, second] = await Promise.all([store.put(bytes), store.put(bytes)]);
    expect(first).toEqual(second);
    expect(first).toEqual({
      sha256: hash(bytes),
      storageKey: `sha256/${hash(bytes).slice(0, 2)}/${hash(bytes)}`,
      bytes: bytes.length,
    });
    expect(objects.size).toBe(1);
    expect([...objects.values()][0]?.includes(bytes)).toBe(false);
    expect(await store.read(first.storageKey, first.sha256)).toEqual(bytes);
  });
  it("isolates owners and rejects corrupted ciphertext and mismatched identity", async () => {
    const { store, client, objects } = fixture();
    const bytes = Buffer.from("Synthetic document");
    const artifact = await store.put(bytes);
    const other = new S3ArtifactStore(client, "synthetic-artifacts", "other-owner", key);
    await expect(other.read(artifact.storageKey, artifact.sha256)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    await expect(store.read("../escape", artifact.sha256)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const original = [...objects.entries()][0];
    if (!original) throw new Error("Missing fixture object.");
    objects.set(original[0], Buffer.from("corrupted plaintext"));
    await expect(store.read(artifact.storageKey, artifact.sha256)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    await expect(store.put(bytes)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(objects.get(original[0])).toEqual(Buffer.from("corrupted plaintext"));
  });
  it("bounds streaming bytes even when content length is absent and destroys the stream", async () => {
    const { store, send } = fixture();
    const body = Readable.from([Buffer.alloc(MAX_STORED_DOCUMENT_BYTES), Buffer.alloc(1)]);
    send.mockImplementationOnce(async () => ({ Body: body }));
    const sha = "a".repeat(64);
    await expect(store.read(store.storageKey(sha), sha)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    expect(body.destroyed).toBe(true);
  });
  it("rejects oversized metadata, missing keys and service errors without leaking their details", async () => {
    const { store, send } = fixture();
    const body = Readable.from([Buffer.from("Synthetic")]);
    send.mockImplementationOnce(async () => ({
      Body: body,
      ContentLength: MAX_STORED_DOCUMENT_BYTES + 1,
    }));
    const sha = "a".repeat(64);
    await expect(store.read(store.storageKey(sha), sha)).rejects.toThrow(
      "Remote artifact storage failed.",
    );
    expect(body.destroyed).toBe(true);
    send.mockRejectedValueOnce(new Error("synthetic-secret-service-details"));
    await expect(store.put(Buffer.from("Synthetic"))).rejects.toThrow(
      "Remote artifact storage failed.",
    );
    const locked = new S3ArtifactStore(
      fixture().client,
      "synthetic-artifacts",
      "synthetic-owner",
      undefined,
    );
    await expect(locked.initialize()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await expect(locked.put(Buffer.from("Synthetic"))).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
  it("keeps local storage as default and refuses remote storage outside a server profile", () => {
    expect(createArtifactStore(loadConfig({})).constructor.name).toBe("ArtifactStore");
    expect(() =>
      createArtifactStore({
        ...loadConfig({}),
        artifactS3: {
          endpoint: "https://storage.synthetic.example",
          bucket: "synthetic-artifacts",
          region: "synthetic",
        },
      }),
    ).toThrow("server profile");
  });
  it("aborts stalled streams at the bound and closes the SDK client", async () => {
    vi.useFakeTimers();
    try {
      const { store, send, client } = fixture();
      const body = new Readable({ read() {} });
      send.mockImplementationOnce(async () => ({ Body: body }));
      const sha = "a".repeat(64);
      const pending = expect(store.read(store.storageKey(sha), sha)).rejects.toMatchObject({
        code: "STORAGE_UNAVAILABLE",
      });
      await vi.advanceTimersByTimeAsync(15000);
      await pending;
      expect(body.destroyed).toBe(true);
      const destroy = vi.spyOn(client, "destroy");
      store.close();
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
