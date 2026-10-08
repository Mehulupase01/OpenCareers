import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DomainError } from "../../contracts/src/index.js";

const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

export class ArtifactStore {
  private root: string;
  private readonly dataDir: string;
  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    this.root = join(this.dataDir, "artifacts");
  }

  async initialize() {
    // Canonicalize the configured trust root, including Windows 8.3 aliases.
    await mkdir(this.dataDir, { recursive: true });
    this.root = join(await realpath(this.dataDir), "artifacts");
    await mkdir(this.root, { recursive: true });
    await this.assertDirectory(this.root);
  }

  private async assertDirectory(directory: string) {
    const metadata = await lstat(directory);
    const physical = await realpath(directory);
    const same =
      process.platform === "win32"
        ? physical.toLowerCase() === directory.toLowerCase()
        : physical === directory;
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || !same)
      throw new DomainError("STORAGE_UNAVAILABLE", "Artifact storage cannot be redirected.");
  }

  storageKey(sha256: string) {
    return `sha256/${sha256.slice(0, 2)}/${sha256}`;
  }

  private path(storageKey: string) {
    if (!/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(storageKey))
      throw new DomainError("NOT_FOUND", "Invalid artifact storage key.");
    return join(this.root, ...storageKey.split("/"));
  }

  async put(buffer: Buffer): Promise<{ sha256: string; storageKey: string; bytes: number }> {
    const sha256 = digest(buffer);
    const storageKey = this.storageKey(sha256);
    const target = this.path(storageKey);
    await this.assertDirectory(this.root);
    const hashes = join(this.root, "sha256");
    await mkdir(hashes, { recursive: true });
    await this.assertDirectory(hashes);
    await mkdir(dirname(target), { recursive: true });
    await this.assertDirectory(dirname(target));
    try {
      if (!(await lstat(target)).isFile())
        throw new DomainError("STORAGE_UNAVAILABLE", "Artifact is not a regular file.");
      const existing = await readFile(target);
      if (digest(existing) !== sha256 || existing.length !== buffer.length)
        throw new DomainError("STORAGE_UNAVAILABLE", "Content-addressed artifact is corrupted.");
      return { sha256, storageKey, bytes: buffer.length };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, buffer, { flag: "wx", mode: 0o600 });
      await rename(temporary, target).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    const written = await readFile(target);
    if (digest(written) !== sha256 || written.length !== buffer.length)
      throw new DomainError("STORAGE_UNAVAILABLE", "Artifact verification failed after write.");
    return { sha256, storageKey, bytes: buffer.length };
  }

  async read(storageKey: string, expectedSha256: string): Promise<Buffer> {
    const target = this.path(storageKey);
    await this.assertDirectory(this.root);
    await this.assertDirectory(join(this.root, "sha256"));
    await this.assertDirectory(dirname(target));
    const metadata = await lstat(target);
    if (!metadata.isFile()) throw new DomainError("NOT_FOUND", "Artifact is not a regular file.");
    const buffer = await readFile(target);
    if (digest(buffer) !== expectedSha256)
      throw new DomainError("STORAGE_UNAVAILABLE", "Artifact hash verification failed.");
    return buffer;
  }
}
