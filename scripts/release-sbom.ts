import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { publicSourceFindings } from "../packages/security/src/public-source.js";
import { normalizeReleaseSbom } from "./release-sbom-validation.js";

try {
  if (process.argv.length !== 2) throw new Error("Release SBOM accepts no arguments.");
  const root = await realpath(resolve(import.meta.dirname, ".."));
  const read = async (name: string) => {
    const path = join(root, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4 * 1024 * 1024)
      throw new Error("Release input must be a bounded regular file.");
    return readFile(path);
  };
  const manifest = await read("package.json"),
    lockfile = await read("pnpm-lock.yaml");
  const args = [
    "sbom",
    "--prod",
    "--lockfile-only",
    "--sbom-format",
    "cyclonedx",
    "--sbom-spec-version",
    "1.6",
    "--sbom-type",
    "application",
  ];
  const allowed = new Set([
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "LOCALAPPDATA",
    "APPDATA",
    "USERPROFILE",
    "HOME",
    "COREPACK_HOME",
    "PNPM_HOME",
  ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())),
  );
  const windows = process.platform === "win32";
  const { stdout } = await promisify(execFile)(
    windows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe") : "corepack",
    windows ? ["/d", "/s", "/c", `corepack pnpm ${args.join(" ")}`] : ["pnpm", ...args],
    {
      cwd: root,
      env,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    },
  );
  if (
    !(await read("package.json")).equals(manifest) ||
    !(await read("pnpm-lock.yaml")).equals(lockfile)
  )
    throw new Error("Release inputs changed during SBOM generation.");
  const bom = normalizeReleaseSbom(
    JSON.parse(stdout),
    JSON.parse(manifest.toString("utf8")),
    lockfile,
  );
  const bytes = Buffer.from(`${JSON.stringify(bom, null, 2)}\n`);
  if (publicSourceFindings("sbom.cdx.json", bytes).length)
    throw new Error("SBOM failed private-data screening.");
  let directory = root;
  for (const part of ["dist", "release"]) {
    directory = join(directory, part);
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.platform === "win32"
        ? (await realpath(directory)).toLowerCase() !== directory.toLowerCase()
        : (await realpath(directory)) !== directory)
    )
      throw new Error("SBOM output directory must not be redirected.");
  }
  const target = join(directory, "sbom.cdx.json");
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new Error("SBOM output must not be redirected.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const staging = await mkdtemp(join(directory, ".sbom-"));
  try {
    const temporary = join(staging, "sbom.json");
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify({
      path: "dist/release/sbom.cdx.json",
      components: bom.components.length,
      realSubmissions: false,
    }),
  );
} catch {
  console.error("Release SBOM generation failed; no release inventory is accepted.");
  process.exitCode = 1;
}
