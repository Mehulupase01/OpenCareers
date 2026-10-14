import { fork } from "node:child_process";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";
import { captureSchema, protectedBackupParent, restoreSchema } from "./sqlite-backup.js";

export const backupRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("capture"), input: captureSchema }).strict(),
  z.object({ operation: z.literal("restore"), input: restoreSchema }).strict(),
]);
const responseSchema = z.union([
  z
    .object({
      directory: z.string(),
      archivePath: z.string(),
      files: z.number().int().positive(),
      scope: z.literal("sqlite-local-files/v1"),
    })
    .strict(),
  z
    .object({
      directory: z.string(),
      dataDir: z.string(),
      runId: z.uuid(),
      restoreBlocked: z.literal(true),
      rekeyed: z.boolean(),
      files: z.number().int().positive(),
    })
    .strict(),
]);

export async function runOfflineBackup(
  raw: z.input<typeof backupRequestSchema>,
  deadlineMs = 300000,
) {
  const request = backupRequestSchema.parse(raw);
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 300000)
    throw new DomainError("CONFIG_INVALID", "Backup worker deadline exceeds its bound.");
  const parent = await protectedBackupParent(request.input.destinationParent);
  const directory = await mkdtemp(join(parent, "opencareers-backup-job-"));
  await chmod(directory, 0o700);
  let success = false;
  try {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|PATH|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(
          key,
        ),
      ),
    );
    const source = import.meta.filename.endsWith(".ts");
    const child = fork(join(import.meta.dirname, `backup-worker.${source ? "ts" : "js"}`), [], {
      env: { ...environment, AUTOPILOT_SKIP_ENV_FILE: "1" },
      execArgv: [...(source ? ["--import", "tsx"] : []), "--max-old-space-size=256"],
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const result = await new Promise<z.infer<typeof responseSchema>>((resolve, reject) => {
      let response: z.infer<typeof responseSchema> | undefined;
      let failed = false;
      const fail = () => {
        failed = true;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(fail, deadlineMs);
      child.once("error", fail);
      child.on("message", (value) => {
        const parsed = responseSchema.safeParse(value);
        if (!parsed.success || response) fail();
        else response = parsed.data;
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (failed || code !== 0 || !response)
          reject(new Error("Backup worker failed or timed out"));
        else resolve(response);
      });
      child.send(
        { ...request, input: { ...request.input, destinationParent: directory } },
        (error) => {
          if (error) fail();
        },
      );
    });
    if (
      dirname(result.directory) !== directory ||
      (await realpath(result.directory)) !== result.directory
    )
      throw new Error("Unexpected backup result directory");
    if (
      request.operation === "capture" &&
      (!("archivePath" in result) || result.archivePath !== join(result.directory, "backup.ocb"))
    )
      throw new Error("Unexpected capture result");
    if (
      request.operation === "restore" &&
      (!("dataDir" in result) || result.dataDir !== join(result.directory, "data"))
    )
      throw new Error("Unexpected restore result");
    success = true;
    return result;
  } catch {
    throw new DomainError(
      "STORAGE_UNAVAILABLE",
      "Offline backup worker failed; no runtime was started or resumed.",
    );
  } finally {
    if (
      !success &&
      dirname(directory) === parent &&
      (await realpath(directory).catch(() => null)) === directory
    )
      await rm(directory, { recursive: true, force: true });
  }
}
