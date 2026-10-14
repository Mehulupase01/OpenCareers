import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { publicSourceFindings } from "../../packages/security/src/public-source.js";
import { buildWindowsBundle } from "../../scripts/windows-bundle.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
describe("Windows runtime bundle", () => {
  let root: string;
  const output: string[] = [];
  beforeEach(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "opencareers-bundle-fixture-"));
    const paths = [
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      ".node-version",
      ".env.example",
      "docs/WINDOWS-BACKUP.md",
      "scripts/windows-runtime.ps1",
      "scripts/windows-startup-host.ps1",
      "dist/scripts/runtime.js",
      "dist/scripts/backup.js",
      "dist/scripts/verify-bundle.js",
      "dist/scripts/bundle-verification.js",
      "dist/scripts/release-smoke.js",
      "dist/scripts/release-smoke-run.js",
      "dist/scripts/release-recovery.js",
      "dist/scripts/release-recovery-run.js",
      "dist/scripts/release-recovery-worker.js",
      "dist/scripts/capacity-fixture.js",
      "dist/scripts/capacity.js",
      "dist/scripts/capacity-run.js",
      "dist/scripts/monitored-capacity.js",
      "dist/scripts/monitored-capacity-run.js",
      "dist/scripts/owned-processes.js",
      "dist/scripts/windows-process-census.js",
      "dist/tests/fixtures/document-packets.js",
      "dist/apps/api/src/main.js",
      "dist/apps/worker/src/main.js",
      "dist/packages/contracts/src/index.js",
      "dist/web/index.html",
    ];
    for (const path of paths) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), "synthetic bundle fixture\n");
      if (path.startsWith("dist/") && !path.startsWith("dist/web/") && path.endsWith(".js")) {
        const source = path.replace(/^dist\//, "").replace(/\.js$/, ".ts");
        await mkdir(dirname(join(root, source)), { recursive: true });
        await writeFile(join(root, source), "synthetic source counterpart\n");
      }
    }
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "synthetic-fixture",
        version: "0.1.0",
        type: "module",
        scripts: { dangerous: "not bundled" },
        dependencies: { yazl: "3.3.1" },
        devDependencies: { typescript: "7.0.2" },
      }),
    );
    await writeFile(join(root, ".env"), "PRIVATE_TEST_CONTENT_NEVER_BUNDLED");
    await mkdir(join(root, "private"));
    await writeFile(join(root, "private/private.txt"), "PRIVATE_TEST_CONTENT_NEVER_BUNDLED");
  });
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    for (const directory of output.splice(0)) await rm(directory, { recursive: true, force: true });
  });
  it("packages only public allowlisted runtime files with verified file/archive checksums", async () => {
    const result = await buildWindowsBundle(root);
    output.push(result.directory);
    const bytes = await readFile(result.path);
    expect(hash(bytes)).toBe(result.checksum);
    expect(await readFile(`${result.path}.sha256`, "utf8")).toContain(result.checksum);
    const archive = await yauzl.fromBufferPromise(bytes, {
      lazyEntries: true,
      strictFileNames: true,
    });
    const files = new Map<string, Buffer>();
    try {
      for await (const entry of archive.eachEntry()) {
        const chunks: Buffer[] = [];
        for await (const chunk of await archive.openReadStreamPromise(entry))
          chunks.push(Buffer.from(chunk));
        files.set(entry.fileName, Buffer.concat(chunks));
      }
    } finally {
      archive.close();
    }
    expect(files.has(".env")).toBe(false);
    expect(files.has("dist/scripts/windows-process-census.js")).toBe(true);
    expect([...files.keys()].some((path) => path.startsWith("private/"))).toBe(false);
    for (const [path, content] of files) expect(publicSourceFindings(path, content)).toEqual([]);
    const manifest = JSON.parse(files.get("bundle-manifest.json")?.toString() ?? "{}");
    expect(manifest).toMatchObject({
      target: "windows-runtime",
      dependenciesBundled: false,
      productionReleaseAccepted: false,
    });
    for (const file of manifest.files) {
      const content = files.get(file.path);
      expect(content?.length).toBe(file.bytes);
      expect(hash(content ?? Buffer.alloc(0))).toBe(file.sha256);
    }
    expect(files.size).toBe(manifest.files.length + 1);
    expect(JSON.parse(files.get("package.json")?.toString() ?? "{}").scripts).toEqual({
      start: "node dist/scripts/runtime.js start",
      runtime: "node dist/scripts/runtime.js",
      backup: "node dist/scripts/backup.js",
      "self-test": "node dist/scripts/release-smoke.js",
      "self-test:recovery": "node dist/scripts/release-recovery.js",
      "verify:bundle": "node dist/scripts/verify-bundle.js",
    });
    const again = await buildWindowsBundle(root);
    output.push(again.directory);
    expect(again.checksum).toBe(result.checksum);
  });
  it("refuses packaging when the native census helper is missing", async () => {
    await rm(join(root, "dist/scripts/windows-process-census.js"));
    await expect(buildWindowsBundle(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects credential-like bytes even in an allowed compiled file", async () => {
    await writeFile(
      join(root, "dist/apps/api/src/main.js"),
      `const secret = "sk-or-v1-${"f".repeat(40)}";`,
    );
    await expect(buildWindowsBundle(root)).rejects.toThrow("private-data screening");
  });
  it("rejects binary private documents and redirected artifact directories", async () => {
    await writeFile(join(root, "dist/web/unknown.pdf"), "not reviewed");
    await expect(buildWindowsBundle(root)).rejects.toThrow("unexpected artifact type");
    await rm(join(root, "dist/web/unknown.pdf"));
    await symlink(
      join(root, "private"),
      join(root, "dist/web/redirect"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(buildWindowsBundle(root)).rejects.toThrow("filesystem redirection");
  });
  it("refuses missing compiled runtime before producing an archive", async () => {
    await rm(join(root, "dist/scripts/runtime.js"));
    await expect(buildWindowsBundle(root)).rejects.toThrow();
  });
  it("refuses stale compiled files without a source counterpart", async () => {
    await writeFile(join(root, "dist/packages/stale.js"), "not an active source output");
    await expect(buildWindowsBundle(root)).rejects.toThrow();
  });
});
