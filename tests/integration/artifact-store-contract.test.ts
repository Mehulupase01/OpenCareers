import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ArtifactStorage,
  ArtifactStore,
} from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { S3ArtifactStore } from "../../packages/documents/src/s3-artifact-store.js";
import { DocumentStorage } from "../../packages/security/src/document-storage.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

describe.each(["local", "s3"] as const)("encrypted artifact contract: %s", (backend) => {
  let store: ArtifactStorage;
  let root: string;
  let objects: Map<string, Buffer>;
  let stop: (() => Promise<void>) | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "opencareers-store-contract-"));
    const key = randomBytes(32).toString("base64");
    objects = new Map();
    if (backend === "local") {
      store = new ArtifactStore(
        root,
        new DocumentStorage("synthetic-owner", "document_artifact", true, key),
      );
    } else {
      const server = createServer(async (request, response) => {
        const name = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (!request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) {
          response.writeHead(403).end();
          return;
        }
        if (request.method === "HEAD") {
          response.writeHead(200).end();
          return;
        }
        if (request.method === "PUT") {
          if (request.headers["if-none-match"] !== "*") {
            response.writeHead(400).end();
            return;
          }
          const chunks = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          if (objects.has(name)) {
            response
              .writeHead(412, { "content-type": "application/xml" })
              .end("<Error><Code>PreconditionFailed</Code></Error>");
            return;
          }
          objects.set(name, Buffer.concat(chunks));
          response.writeHead(200).end();
          return;
        }
        const bytes = objects.get(name);
        if (request.method !== "GET" || !bytes) {
          response
            .writeHead(404, { "content-type": "application/xml" })
            .end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        response
          .writeHead(200, {
            "content-length": bytes.length,
            "content-type": "application/octet-stream",
          })
          .end(bytes);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture port.");
      const client = new S3Client({
        endpoint: `http://127.0.0.1:${address.port}`,
        region: "synthetic",
        forcePathStyle: true,
        maxAttempts: 1,
        credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
      });
      store = new S3ArtifactStore(client, "synthetic-artifacts", "synthetic-owner", key);
      stop = () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    }
    await store.initialize();
  });
  afterEach(async () => {
    store?.close?.();
    await stop?.();
    stop = undefined;
    await rm(root, { recursive: true, force: true });
  });
  const physical = (storageKey: string) => join(root, "artifacts", ...storageKey.split("/"));
  it("round trips, deduplicates concurrent writes and stores no plaintext", async () => {
    const bytes = Buffer.from("Synthetic encrypted letter contract");
    const [first, second] = await Promise.all([store.put(bytes), store.put(bytes)]);
    expect(second).toEqual(first);
    expect(await store.read(first.storageKey, first.sha256)).toEqual(bytes);
    const stored =
      backend === "local" ? await readFile(physical(first.storageKey)) : [...objects.values()][0];
    expect(stored?.includes(bytes)).toBe(false);
  });
  it("rejects tampering and never overwrites a corrupted existing identity", async () => {
    const bytes = Buffer.from("Synthetic checked bytes");
    const artifact = await store.put(bytes);
    const altered = Buffer.from("tampered synthetic ciphertext");
    if (backend === "local") await writeFile(physical(artifact.storageKey), altered);
    else objects.set([...objects.keys()][0] ?? "", altered);
    await expect(store.read(artifact.storageKey, artifact.sha256)).rejects.toThrow();
    await expect(store.put(bytes)).rejects.toThrow();
    const stored =
      backend === "local"
        ? await readFile(physical(artifact.storageKey))
        : [...objects.values()][0];
    expect(stored).toEqual(altered);
  });
  it("rejects empty documents and key/identity mismatch", async () => {
    await expect(store.put(Buffer.alloc(0))).rejects.toThrow();
    await expect(store.read("../outside", "a".repeat(64))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("generates and reads back the same valid packet artifacts through either backend", async () => {
    const packet = await buildPacket(store, { ...documentGenerationInput(), requestedAnswers: [] });
    expect(packet.manifest.validation.status).toBe("valid");
    expect(packet.manifest.artifacts.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["cv_pdf", "cv_docx", "letter_pdf", "letter_docx"]),
    );
    for (const artifact of packet.manifest.artifacts) {
      const bytes = await store.read(artifact.storageKey, artifact.sha256);
      expect(bytes.length).toBe(artifact.bytes);
      if (artifact.kind.endsWith("_pdf")) expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
      if (artifact.kind.endsWith("_docx")) expect(bytes.subarray(0, 2).toString()).toBe("PK");
    }
  });
});
