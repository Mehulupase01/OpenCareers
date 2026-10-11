import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "../../config/src/index.js";
import { DomainError } from "../../contracts/src/index.js";
import { DocumentStorage, MAX_STORED_DOCUMENT_BYTES } from "../../security/src/document-storage.js";
import { type ArtifactStorage, ArtifactStore } from "./artifact-store.js";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const unavailable = () =>
  new DomainError("STORAGE_UNAVAILABLE", "Remote artifact storage failed.", true);

export class S3ArtifactStore implements ArtifactStorage {
  private readonly prefix: string;
  private readonly codec: DocumentStorage;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    ownerId: string,
    vaultKey: string | undefined,
  ) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
      throw new DomainError("CONFIG_INVALID", "Invalid artifact bucket.");
    this.prefix = `owners/${digest(Buffer.from(ownerId))}/artifacts/`;
    this.codec = new DocumentStorage(ownerId, "document_artifact", true, vaultKey);
  }

  async initialize() {
    this.codec.assertReady();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
        abortSignal: AbortSignal.timeout(15000),
      });
    } catch {
      throw unavailable();
    }
  }

  close() {
    this.client.destroy();
  }

  storageKey(sha256: string) {
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new DomainError("NOT_FOUND", "Invalid artifact identity.");
    return `sha256/${sha256.slice(0, 2)}/${sha256}`;
  }

  async put(buffer: Buffer) {
    const encoded = this.codec.encode(buffer);
    const sha256 = digest(buffer);
    const storageKey = this.storageKey(sha256);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.prefix + storageKey,
          Body: encoded,
          ContentType: "application/octet-stream",
          ContentLength: encoded.length,
          ChecksumSHA256: createHash("sha256").update(encoded).digest("base64"),
          IfNoneMatch: "*",
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
    } catch (error) {
      // Concurrent identical writes never overwrite ciphertext: read and verify
      // the winning object. Other failures are not assumed to be successful.
      if (
        typeof error !== "object" ||
        error === null ||
        !("$metadata" in error) ||
        (error.$metadata as { httpStatusCode?: number })?.httpStatusCode !== 412
      )
        throw unavailable();
    }
    const written = await this.read(storageKey, sha256);
    if (written.length !== buffer.length) throw unavailable();
    return { sha256, storageKey, bytes: buffer.length };
  }

  async read(storageKey: string, expectedSha256: string) {
    this.codec.assertReady();
    if (storageKey !== this.storageKey(expectedSha256))
      throw new DomainError("NOT_FOUND", "Artifact key does not match its identity.");
    let body: Readable | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.prefix + storageKey }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
      body = result.Body as Readable | undefined;
      if (!body || typeof body.destroy !== "function" || !body[Symbol.asyncIterator])
        throw unavailable();
      if (
        result.ContentLength !== undefined &&
        (!Number.isSafeInteger(result.ContentLength) ||
          result.ContentLength < 1 ||
          result.ContentLength > MAX_STORED_DOCUMENT_BYTES)
      )
        throw unavailable();
      timer = setTimeout(() => body?.destroy(unavailable()), 15000).unref();
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of body) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += data.length;
        if (bytes > MAX_STORED_DOCUMENT_BYTES) throw unavailable();
        chunks.push(data);
      }
      if (result.ContentLength !== undefined && bytes !== result.ContentLength) throw unavailable();
      return this.codec.decode(Buffer.concat(chunks), expectedSha256);
    } catch {
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      body?.destroy();
    }
  }
}

export function createArtifactStore(config: Config): ArtifactStorage {
  if (!config.artifactS3)
    return new ArtifactStore(
      config.dataDir,
      DocumentStorage.fromConfig(config, "document_artifact"),
    );
  if (config.profile !== "server")
    throw new DomainError("CONFIG_INVALID", "Remote artifacts require the server profile.");
  const client = new S3Client({
    region: config.artifactS3.region,
    endpoint: config.artifactS3.endpoint,
    forcePathStyle: true,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 15000 },
  });
  return new S3ArtifactStore(client, config.artifactS3.bucket, config.ownerId, config.vaultKey);
}
