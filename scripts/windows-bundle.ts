import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ZipFile } from "yazl";
import { publicSourceFindings } from "../packages/security/src/public-source.js";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const required = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".node-version",
  ".env.example",
  "scripts/windows-runtime.ps1",
  "scripts/windows-startup-host.ps1",
  "dist/scripts/runtime.js",
  "dist/apps/api/src/main.js",
  "dist/apps/worker/src/main.js",
  "dist/web/index.html",
];

export async function buildWindowsBundle(root = resolve(import.meta.dirname, "..")) {
  root = await realpath(root);
  const files = new Map<string, Buffer>();
  let bytes = 0;
  const add = async (path: string) => {
    const source = join(root, path);
    const physical = await realpath(source);
    if (
      process.platform === "win32"
        ? physical.toLowerCase() !== source.toLowerCase()
        : physical !== source
    )
      throw new Error("Bundle source contains filesystem redirection.");
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024)
      throw new Error("Bundle source must be a bounded regular file.");
    const content = await readFile(source);
    if (publicSourceFindings(path, content).length)
      throw new Error("Bundle source failed private-data screening.");
    if (!files.has(path)) bytes += content.length;
    files.set(path, content);
    if (files.size > 2000 || bytes > 128 * 1024 * 1024)
      throw new Error("Bundle exceeded its file or byte bound.");
  };
  let visited = 0;
  const walk = async (path: string) => {
    if (++visited > 4000 || path.split("/").length > 40)
      throw new Error("Bundle traversal exceeded its bound.");
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink()) throw new Error("Bundle source contains filesystem redirection.");
    if (info.isDirectory()) {
      for (const entry of (await readdir(join(root, path))).sort()) await walk(`${path}/${entry}`);
    } else {
      if (!path.startsWith("dist/web/")) {
        if (!path.endsWith(".js")) throw new Error("Unexpected compiled runtime artifact.");
        const source = path.replace(/^dist\//, "").replace(/\.js$/, ".ts");
        const sourceInfo = await lstat(join(root, source));
        if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink())
          throw new Error("Compiled artifact has no regular source counterpart.");
      }
      if (!/\.(?:js|mjs|json|css|html|woff2?|ttf|svg|png)$/.test(path))
        throw new Error("Bundle source has an unexpected artifact type.");
      await add(path);
    }
  };
  for (const path of required) await add(path);
  for (const path of ["dist/apps/api", "dist/apps/worker", "dist/packages", "dist/web"])
    await walk(path);
  const original = JSON.parse(files.get("package.json")?.toString() ?? "{}");
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(original.version ?? ""))
    throw new Error("Bundle package version is invalid.");
  const manifest = {
    ...original,
    scripts: {
      start: "node dist/scripts/runtime.js start",
      runtime: "node dist/scripts/runtime.js",
    },
  };
  files.set("package.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  files.set(
    "INSTALL.md",
    Buffer.from(`# OpenCareers Windows Runtime Bundle

This precompiled bundle requires the exact Node version in .node-version and
pnpm 12.4.2. Node, dependencies and Chromium are not bundled or offline-certified.
Extract to a new non-synced local directory. Do not overwrite a running install.

Verify the ZIP's SHA-256 against its separately supplied .sha256 file before
extraction. Compare extracted files against bundle-manifest.json. Checksums
detect corruption, not publisher identity; this bundle is not code-signed.

From the extracted directory:

    corepack pnpm install --prod --frozen-lockfile
    corepack pnpm exec playwright install chromium

The default start is synthetic demo mode; it cannot apply to real employers.
Use node dist/scripts/runtime.js start with a clean environment and no private
key for a demo. The API and compiled dashboard share the configured API port.
Do not run a second demo instance on an occupied port.

For local private operation, prepare an absolute config file outside the bundle,
with private data outside the installation on a non-synced disk. Then use:

    powershell.exe -NoProfile -File scripts/windows-runtime.ps1 -Mode Start -ConfigFile <absolute-config> -NodePath <absolute-node>

Status and Stop use the same arguments with their respective Mode. Startup
installation/removal require -ApproveStartup; use -WhatIf first. The startup
task runs at current-user logon, not while logged out. Private operation still
requires reviewed facts, authorized policy and supported routes. This is not
live-submission, reboot, soak, server/hybrid or complete-release evidence.

Upgrade/rollback: stop the old runtime first and verify no active worker remains.
Keep one authoritative data directory. Never restore an older DB merely to roll
back code; use the documented restore-blocked reconciliation process for a real
restore. Do not run old code against a newer unsupported schema. This bundle
does not automate migration, backup or rollback.
`),
  );
  for (const [path, content] of files) {
    if (publicSourceFindings(path, content).length)
      throw new Error("Final bundle failed private-data screening.");
  }
  const entries = [...files].sort(([a], [b]) => a.localeCompare(b));
  const metadata = {
    schemaVersion: 1,
    version: original.version,
    target: "windows-runtime",
    dependenciesBundled: false,
    productionReleaseAccepted: false,
    files: entries.map(([path, content]) => ({
      path,
      bytes: content.length,
      sha256: sha256(content),
    })),
  };
  files.set("bundle-manifest.json", Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`));
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    zip.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    zip.addBuffer(content, path, {
      mtime: new Date("2020-01-01T00:00:00Z"),
      forceDosTimestamp: true,
    });
  zip.end();
  const archive = await complete;
  const directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers-windows-bundle-"));
  const filename = `opencareers-${original.version}-windows-runtime.zip`;
  const path = join(directory, filename);
  const checksum = sha256(archive);
  await writeFile(path, archive, { flag: "wx" });
  await writeFile(`${path}.sha256`, `${checksum}  ${filename}\n`, { flag: "wx" });
  return { directory, path, checksum, files: files.size, bytes: archive.length };
}
