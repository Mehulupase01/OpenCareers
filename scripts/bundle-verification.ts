import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

const limit = 128 * 1024 * 1024;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const bundleInputPaths = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".node-version",
  ".env.example",
  "scripts/windows-runtime.ps1",
  "scripts/windows-startup-host.ps1",
  "dist/scripts/runtime.js",
  "dist/scripts/verify-bundle.js",
  "dist/scripts/bundle-verification.js",
  "dist/scripts/release-smoke.js",
  "dist/scripts/release-smoke-run.js",
  "dist/scripts/release-recovery.js",
  "dist/scripts/release-recovery-run.js",
  "dist/scripts/release-recovery-worker.js",
  "dist/scripts/capacity-fixture.js",
  "dist/tests/fixtures/document-packets.js",
  "dist/apps/api/src/main.js",
  "dist/apps/worker/src/main.js",
  "dist/web/index.html",
] as const;
const rootFiles = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".node-version",
  ".env.example",
  "INSTALL.md",
  "scripts/windows-runtime.ps1",
  "scripts/windows-startup-host.ps1",
]);
const scriptNames = new Set([
  "runtime.js",
  "release-smoke.js",
  "release-smoke-run.js",
  "release-recovery.js",
  "release-recovery-run.js",
  "release-recovery-worker.js",
  "capacity-fixture.js",
  "verify-bundle.js",
  "bundle-verification.js",
]);
function distributedPath(path: string) {
  if (
    path.length > 400 ||
    !/^[A-Za-z0-9._/-]+$/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.split("/").length > 40
  )
    return false;
  return (
    rootFiles.has(path) ||
    (path.startsWith("dist/scripts/") && scriptNames.has(path.slice("dist/scripts/".length))) ||
    path === "dist/tests/fixtures/document-packets.js" ||
    /^dist\/(?:apps\/(?:api|worker)|packages)\/.+\.js$/.test(path) ||
    /^dist\/web\/.+\.(?:js|mjs|json|css|html|woff2?|ttf|svg|png)$/.test(path)
  );
}
function record(raw: unknown, keys: string[]): raw is Record<string, unknown> {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.keys(raw).length === keys.length &&
    keys.every((key) => Object.hasOwn(raw, key))
  );
}
function parseManifest(raw: unknown) {
  if (
    !record(raw, [
      "schemaVersion",
      "version",
      "target",
      "dependenciesBundled",
      "productionReleaseAccepted",
      "files",
    ]) ||
    raw.schemaVersion !== 1 ||
    raw.target !== "windows-runtime" ||
    raw.dependenciesBundled !== false ||
    raw.productionReleaseAccepted !== false ||
    typeof raw.version !== "string" ||
    raw.version.length > 80 ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(raw.version) ||
    !Array.isArray(raw.files) ||
    !raw.files.length ||
    raw.files.length > 2000
  )
    throw new Error("Bundle manifest is unsupported or exceeds its bounds.");
  const seen = new Set<string>();
  let bytes = 0;
  const files = raw.files.map((file: unknown) => {
    if (
      !record(file, ["path", "bytes", "sha256"]) ||
      typeof file.path !== "string" ||
      !distributedPath(file.path) ||
      typeof file.bytes !== "number" ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > 32 * 1024 * 1024 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error("Bundle entry is invalid.");
    const folded = file.path.toLowerCase();
    if (seen.has(folded)) throw new Error("Bundle entries collide.");
    seen.add(folded);
    bytes += file.bytes;
    if (bytes > limit) throw new Error("Bundle byte bound exceeded.");
    return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
  });
  const paths = new Set(files.map((file) => file.path));
  if ([...bundleInputPaths, "INSTALL.md"].some((path) => !paths.has(path)))
    throw new Error("Bundle manifest omits required runtime artifacts.");
  return { version: raw.version, files, bytes };
}

async function regularPath(root: string, path: string) {
  const parts = path.split("/");
  let target = root;
  for (const [index, part] of parts.entries()) {
    target = join(target, part);
    const info = await lstat(target);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error("Bundle files must not be redirected.");
  }
  const physical = await realpath(target);
  if (
    process.platform === "win32"
      ? physical.toLowerCase() !== target.toLowerCase()
      : physical !== target
  )
    throw new Error("Bundle files must not be redirected.");
  return target;
}

async function readStable(path: string, maxBytes: number) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes)
    throw new Error("Bundle file exceeds its bound or is redirected.");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
      throw new Error("Bundle file changed while opening.");
    const buffer = Buffer.allocUnsafe(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(path);
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.isSymbolicLink()
    )
      throw new Error("Bundle file changed while reading.");
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

// Native-only: usable before dependencies are installed; never reads owner configuration.
export async function verifyWindowsBundle(directory: string, expectedManifestSha256?: string) {
  if (expectedManifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedManifestSha256))
    throw new Error("Expected manifest digest is invalid.");
  const root = await realpath(resolve(directory));
  const manifestPath = await regularPath(root, "bundle-manifest.json");
  const manifestBytes = await readStable(manifestPath, 1024 * 1024);
  const manifestSha256 = digest(manifestBytes);
  if (expectedManifestSha256 && manifestSha256 !== expectedManifestSha256)
    throw new Error("Bundle manifest differs from the expected digest.");
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
  const listed = new Set(manifest.files.map((file) => file.path));
  for (const file of manifest.files) {
    const path = await regularPath(root, file.path);
    const before = await lstat(path);
    if (before.size !== file.bytes) throw new Error("Bundle artifact size differs.");
    const bytes = await readStable(path, file.bytes);
    const after = await lstat(path);
    if (
      bytes.length !== file.bytes ||
      digest(bytes) !== file.sha256 ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.mtimeMs !== after.mtimeMs ||
      after.size !== before.size
    )
      throw new Error("Bundle artifact integrity differs.");
  }
  const pending = ["dist"];
  let visited = 0;
  while (pending.length) {
    const path = pending.pop();
    if (!path) break;
    if (++visited > 4000 || path.split("/").length > 40)
      throw new Error("Bundle traversal exceeds its bound.");
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink()) throw new Error("Bundle runtime tree is redirected.");
    if (info.isDirectory()) {
      for await (const child of await opendir(join(root, path))) {
        if (pending.length + visited >= 4000)
          throw new Error("Bundle traversal exceeds its bound.");
        pending.push(`${path}/${child.name}`);
      }
    } else if (!info.isFile() || !listed.has(path)) {
      throw new Error("Bundle runtime tree contains an unlisted artifact.");
    }
  }
  return {
    status: "integrity_verified" as const,
    scope: "distributed_manifest_artifacts" as const,
    version: manifest.version,
    files: manifest.files.length,
    bytes: manifest.bytes,
    manifestSha256,
    expectedManifestMatched: expectedManifestSha256 !== undefined,
    publisherIdentityVerified: false as const,
    dependenciesVerified: false as const,
    productionReleaseAccepted: false as const,
  };
}
