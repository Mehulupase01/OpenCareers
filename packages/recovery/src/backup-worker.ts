import { backupRequestSchema } from "./backup-process.js";
import { captureSqliteBackup, restoreSqliteBackup } from "./sqlite-backup.js";

process.once("disconnect", () => process.exit(1));
process.once("message", async (raw) => {
  try {
    const request = backupRequestSchema.parse(raw);
    const result =
      request.operation === "capture"
        ? await captureSqliteBackup(request.input)
        : await restoreSqliteBackup(request.input);
    process.send?.(result, () => {
      process.removeAllListeners("disconnect");
      process.disconnect();
    });
  } catch {
    process.exitCode = 1;
    process.disconnect();
  }
});
