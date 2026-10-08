import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";

describe("artifact storage trust boundaries", () => {
  let root: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-artifacts-")));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const redirect = (target: string, link: string) =>
    symlink(target, link, process.platform === "win32" ? "junction" : "dir");

  it("canonicalizes a trusted data-root alias and stores checksummed bytes", async () => {
    const data = join(root, "data");
    await mkdir(data);
    const alias = join(root, "alias");
    await redirect(data, alias);
    const store = new ArtifactStore(alias);
    await store.initialize();
    const bytes = Buffer.from("Synthetic document bytes");
    const artifact = await store.put(bytes);
    expect(await store.read(artifact.storageKey, artifact.sha256)).toEqual(bytes);
    expect(await store.put(bytes)).toEqual(artifact);
  });

  it("rejects a redirected artifact root without writing to it", async () => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await redirect(outside, join(root, "artifacts"));
    await expect(new ArtifactStore(root).initialize()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });

  it("rejects a redirected hash directory", async () => {
    const store = new ArtifactStore(root);
    await store.initialize();
    const outside = join(root, "outside");
    await mkdir(outside);
    await redirect(outside, join(root, "artifacts", "sha256"));
    await expect(store.put(Buffer.from("Synthetic"))).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });

  it("refuses corrupted content and invalid storage keys", async () => {
    const store = new ArtifactStore(root);
    await store.initialize();
    const artifact = await store.put(Buffer.from("Synthetic"));
    await writeFile(join(root, "artifacts", ...artifact.storageKey.split("/")), "Changed");
    await expect(store.read(artifact.storageKey, artifact.sha256)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    await expect(store.put(Buffer.from("Synthetic"))).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    await expect(store.read("../escape", artifact.sha256)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("does not accept a symlink as an artifact", async () => {
    const store = new ArtifactStore(root);
    await store.initialize();
    const bytes = Buffer.from("Synthetic");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const directory = join(root, "artifacts", "sha256", hash.slice(0, 2));
    await mkdir(directory, { recursive: true });
    const outside = join(root, "outside.txt");
    await writeFile(outside, bytes);
    // File symlinks require Developer Mode on Windows; a directory junction also
    // proves that no redirected filesystem object is accepted as document bytes.
    if (process.platform === "win32") {
      const outsideDirectory = join(root, "outside-dir");
      await mkdir(outsideDirectory);
      await redirect(outsideDirectory, join(directory, hash));
    } else await symlink(outside, join(directory, hash));
    expect((await lstat(join(directory, hash))).isSymbolicLink()).toBe(true);
    await expect(store.read(store.storageKey(hash), hash)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
