import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleInputPaths, verifyWindowsBundle } from "../../scripts/bundle-verification.js";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
describe("native-only extracted bundle integrity", () => {
  let root: string;
  let manifest: {
    schemaVersion: number;
    version: string;
    target: string;
    dependenciesBundled: boolean;
    productionReleaseAccepted: boolean;
    files: { path: string; bytes: number; sha256: string }[];
  };
  const save = () => writeFile(join(root, "bundle-manifest.json"), JSON.stringify(manifest));
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "opencareers-integrity-"));
    manifest = {
      schemaVersion: 1,
      version: "0.1.0",
      target: "windows-runtime",
      dependenciesBundled: false,
      productionReleaseAccepted: false,
      files: [],
    };
    for (const path of new Set([
      "package.json",
      "dist/apps/api/src/main.js",
      "dist/web/index.html",
      ...bundleInputPaths,
      "INSTALL.md",
    ])) {
      const bytes = Buffer.from("synthetic distributed fixture");
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes);
      manifest.files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
    }
    await save();
  });
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("verifies only public distribution bytes without reading local configuration or dependencies", async () => {
    await writeFile(join(root, ".env"), "PRIVATE_SENTINEL_NEVER_READ");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules/private.txt"), "PRIVATE_SENTINEL_NEVER_READ");
    const manifestSha256 = sha(await readFile(join(root, "bundle-manifest.json")));
    const result = await verifyWindowsBundle(root, manifestSha256);
    expect(result).toEqual({
      status: "integrity_verified",
      scope: "distributed_manifest_artifacts",
      version: "0.1.0",
      files: manifest.files.length,
      bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      manifestSha256,
      expectedManifestMatched: true,
      publisherIdentityVerified: false,
      dependenciesVerified: false,
      productionReleaseAccepted: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SENTINEL|\.env|private\.txt/);
    expect((await verifyWindowsBundle(root)).expectedManifestMatched).toBe(false);
    await expect(verifyWindowsBundle(root, "0".repeat(64))).rejects.toThrow("expected digest");
    await expect(verifyWindowsBundle(root, "private secret")).rejects.toThrow("digest is invalid");
  });
  it("refuses same-length tampering, missing and oversized distributed files", async () => {
    const path = join(root, "dist/apps/api/src/main.js");
    await writeFile(path, Buffer.alloc(manifest.files[1]?.bytes ?? 0, 120));
    await expect(verifyWindowsBundle(root)).rejects.toThrow("integrity differs");
    await writeFile(path, "too large".repeat(100));
    await expect(verifyWindowsBundle(root)).rejects.toThrow("size differs");
    await rm(path);
    await expect(verifyWindowsBundle(root)).rejects.toThrow();
  });
  it.each([
    "../private.txt",
    "/private.txt",
    "C:/private.txt",
    "dist/../.env",
    ".env",
    "private/cv.pdf",
    "dist/web/cv.pdf",
    "dist\\web\\index.html",
    "dist//web/index.html",
    "dist/web/./index.html",
  ])("refuses unsafe or private manifest path %s", async (path) => {
    manifest.files[0] = { path, bytes: 1, sha256: "a".repeat(64) };
    await save();
    await expect(verifyWindowsBundle(root)).rejects.toThrow("entry is invalid");
  });
  it("rejects duplicate and Windows case-colliding entries before any artifact read", async () => {
    manifest.files.push({
      ...(manifest.files[1] as (typeof manifest.files)[number]),
      path: "dist/apps/api/src/MAIN.js",
    });
    await save();
    await expect(verifyWindowsBundle(root)).rejects.toThrow("collide");
    manifest.files[manifest.files.length - 1] = {
      ...(manifest.files[1] as (typeof manifest.files)[number]),
    };
    await save();
    await expect(verifyWindowsBundle(root)).rejects.toThrow("collide");
  });
  it("rejects unknown schema fields, release flags and traversal/byte bounds", async () => {
    for (const changed of [
      { ...manifest, schemaVersion: 2 },
      { ...manifest, secret: "PRIVATE_SENTINEL" },
      { ...manifest, productionReleaseAccepted: true },
      { ...manifest, files: [] },
      { ...manifest, files: Array.from({ length: 2001 }, () => manifest.files[0]) },
      { ...manifest, version: `${"1".repeat(100)}.0.0` },
    ]) {
      await writeFile(join(root, "bundle-manifest.json"), JSON.stringify(changed));
      await expect(verifyWindowsBundle(root)).rejects.toThrow("manifest is unsupported");
    }
    manifest.files[0] = { ...(manifest.files[0] as (typeof manifest.files)[number]), bytes: -1 };
    await save();
    await expect(verifyWindowsBundle(root)).rejects.toThrow("entry is invalid");
    manifest.files = Array.from({ length: 5 }, (_, index) => ({
      path: `dist/apps/api/src/large-${index}.js`,
      bytes: 32 * 1024 * 1024,
      sha256: "a".repeat(64),
    }));
    await save();
    await expect(verifyWindowsBundle(root)).rejects.toThrow("byte bound");
    await writeFile(join(root, "bundle-manifest.json"), "x".repeat(1024 * 1024 + 1));
    await expect(verifyWindowsBundle(root)).rejects.toThrow("exceeds its bound");
  });
  it("refuses unlisted runtime artifacts without inspecting their private-shaped bytes", async () => {
    await writeFile(join(root, "dist/private.txt"), "PRIVATE_SENTINEL_NEVER_READ");
    await expect(verifyWindowsBundle(root)).rejects.toThrow("unlisted artifact");
  });
  it("refuses a manifest that omits required application artifacts", async () => {
    manifest.files = manifest.files.filter((file) => file.path !== "dist/apps/worker/src/main.js");
    await save();
    await expect(verifyWindowsBundle(root)).rejects.toThrow("omits required runtime artifacts");
  });
  it("refuses redirected runtime directories", async () => {
    const outside = await mkdtemp(join(tmpdir(), "opencareers-integrity-outside-"));
    try {
      await rm(join(root, "dist/web"), { recursive: true });
      await writeFile(join(outside, "index.html"), "PRIVATE_SENTINEL");
      await symlink(
        outside,
        join(root, "dist/web"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(verifyWindowsBundle(root)).rejects.toThrow("redirected");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform === "win32")("refuses a redirected manifest file", async () => {
    const outside = await mkdtemp(join(tmpdir(), "opencareers-integrity-link-"));
    try {
      await rm(join(root, "bundle-manifest.json"));
      await writeFile(join(outside, "manifest.json"), JSON.stringify(manifest));
      await symlink(join(outside, "manifest.json"), join(root, "bundle-manifest.json"));
      await expect(verifyWindowsBundle(root)).rejects.toThrow("redirected");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
