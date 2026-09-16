import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Extraction, extractionSchema } from "../../contracts/src/candidate.js";
import { DomainError } from "../../contracts/src/index.js";
import type { CandidateRepository } from "../../persistence/src/candidate-repository.js";
import { MAX_SOURCE_BYTES } from "./extract.js";

export async function parseIsolated(
  bytes: Buffer,
  format: "pdf" | "docx",
  timeoutMs = 15000,
): Promise<Extraction> {
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES)
    throw new DomainError("CONFIG_INVALID", "Sources must be 1 byte to 10 MiB.");
  const source = import.meta.url.endsWith(".ts");
  const worker = fork(
    fileURLToPath(new URL(source ? "./parse-worker.ts" : "./parse-worker.js", import.meta.url)),
    [],
    {
      execArgv: [...(source ? ["--import", "tsx"] : []), "--max-old-space-size=256"],
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
      windowsHide: true,
    },
  );
  return new Promise((resolveResult, reject) => {
    let result: Extraction | undefined;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new DomainError("CONFIG_INVALID", "Document parsing exceeded its time limit.");
      worker.kill("SIGKILL");
    }, timeoutMs);
    worker.on("error", () => {
      failure = new DomainError("CONFIG_INVALID", "Document parser could not start.");
    });
    worker.on("message", (message: unknown) => {
      const response = message as { ok: boolean; extraction: unknown };
      const parsed = response.ok ? extractionSchema.safeParse(response.extraction) : null;
      if (parsed?.success) result = parsed.data;
      else
        failure = new DomainError(
          "CONFIG_INVALID",
          "Document could not be parsed safely; check its format, encryption and size.",
        );
    });
    worker.once("close", (code) => {
      clearTimeout(timer);
      if (!failure && result && code === 0) resolveResult(result);
      else
        reject(
          failure ??
            new DomainError("CONFIG_INVALID", "Document parser exited without a complete report."),
        );
    });
    worker.send({ bytes, format }, (error) => {
      if (error) {
        failure = new DomainError(
          "CONFIG_INVALID",
          "Document parser could not receive the source.",
        );
        worker.kill("SIGKILL");
      }
    });
  });
}

export class CandidateImporter {
  private active = 0;
  constructor(
    private readonly repository: CandidateRepository,
    private readonly dataDir: string,
  ) {}
  async import(bytes: Buffer, filename: string) {
    if (this.active >= 2)
      throw new DomainError("RATE_LIMITED", "Two document imports are already running.");
    const name = basename(filename.replaceAll("\\", "/"));
    const format = extname(name).toLowerCase().slice(1);
    if (
      !["pdf", "docx"].includes(format) ||
      name.length > 240 ||
      [...name].some((c) => c.charCodeAt(0) < 32)
    )
      throw new DomainError("CONFIG_INVALID", "Choose a PDF or DOCX file.");
    this.active++;
    try {
      const extraction = await parseIsolated(bytes, format as "pdf" | "docx");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const ownerKey = createHash("sha256").update(this.repository.ownerId).digest("hex");
      const storageKey = join("candidate-sources", ownerKey, sha256);
      // Resolve the trusted root first: Windows short-name aliases are not redirects.
      await mkdir(this.dataDir, { recursive: true });
      const root = await realpath(this.dataDir);
      const target = resolve(root, storageKey);
      await mkdir(dirname(target), { recursive: true });
      const physical = await realpath(dirname(target));
      if (
        process.platform === "win32"
          ? physical.toLowerCase() !== dirname(target).toLowerCase()
          : physical !== dirname(target)
      )
        throw new DomainError("CONFIG_INVALID", "Candidate storage must not be redirected.");
      const temporary = `${target}.${randomUUID()}.pending`;
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
      } finally {
        await unlink(temporary);
      }
      if (
        !(await lstat(target)).isFile() ||
        createHash("sha256")
          .update(await readFile(target))
          .digest("hex") !== sha256
      )
        throw new DomainError("STORAGE_UNAVAILABLE", "Stored source checksum mismatch.");
      const id = await this.repository.registerSource({
        name,
        sha256,
        bytes: bytes.length,
        storageKey,
        extraction,
      });
      return this.repository.source(id);
    } finally {
      this.active--;
    }
  }
}
