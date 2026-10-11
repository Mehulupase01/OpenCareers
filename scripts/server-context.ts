import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import yauzl from "yauzl";
import { publicSourceFindings } from "../packages/security/src/public-source.js";
import { buildWindowsBundle } from "./windows-bundle.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export async function createServerBuildContext(root = resolve(import.meta.dirname, "..")) {
  root = await realpath(root);
  const bundle = await buildWindowsBundle(root);
  const archiveBytes = await readFile(bundle.path);
  if (hash(archiveBytes) !== bundle.checksum) throw new Error("Screened context archive changed.");
  const directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers-server-context-"));
  const archive = await yauzl.fromBufferPromise(archiveBytes, {
    lazyEntries: true,
    strictFileNames: true,
  });
  const entries: { path: string; bytes: number; sha256: string }[] = [];
  let total = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      const path = entry.fileName;
      if (
        !/^[A-Za-z0-9._/-]+$/.test(path) ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error("Invalid screened context path.");
      if (
        !["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(path) &&
        !path.startsWith("dist/")
      )
        continue;
      if (entry.uncompressedSize > 32 * 1024 * 1024 || ++total > 2000)
        throw new Error("Context entry exceeds its bound.");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of await archive.openReadStreamPromise(entry)) {
        bytes += chunk.length;
        if (bytes > entry.uncompressedSize)
          throw new Error("Context entry grew beyond its declared size.");
        chunks.push(Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks);
      if (content.length !== entry.uncompressedSize || publicSourceFindings(path, content).length)
        throw new Error("Context entry failed byte/privacy validation.");
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content, { flag: "wx" });
      entries.push({ path, bytes: content.length, sha256: hash(content) });
    }
    const dockerfile = join(root, "deploy/server/Dockerfile");
    const info = await lstat(dockerfile);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 65536 ||
      (await realpath(dockerfile)) !== dockerfile
    )
      throw new Error("Dockerfile must be a bounded regular public file.");
    const content = await readFile(dockerfile);
    if (publicSourceFindings("deploy/server/Dockerfile", content).length)
      throw new Error("Dockerfile failed privacy screening.");
    await writeFile(join(directory, "Dockerfile"), content, { flag: "wx" });
    entries.push({ path: "Dockerfile", bytes: content.length, sha256: hash(content) });
    const manifest = Buffer.from(
      `${JSON.stringify({ schemaVersion: 1, sourceBundleSha256: bundle.checksum, files: entries.sort((a, b) => a.path.localeCompare(b.path)), productionReleaseAccepted: false }, null, 2)}\n`,
    );
    await writeFile(join(directory, "context-manifest.json"), manifest, { flag: "wx" });
    return {
      directory,
      bundleDirectory: bundle.directory,
      files: entries.length,
      manifestSha256: hash(manifest),
      productionReleaseAccepted: false,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    await rm(bundle.directory, { recursive: true, force: true });
    throw error;
  } finally {
    archive.close();
  }
}
