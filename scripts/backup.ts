import { isAbsolute } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { loadConfig } from "../packages/config/src/index.js";
import { runOfflineBackup } from "../packages/recovery/src/backup-process.js";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: "string" },
      destination: { type: "string" },
      archive: { type: "string" },
      "confirm-offline": { type: "boolean" },
      "confirm-protected-destination": { type: "boolean" },
    },
  });
  if (
    positionals.length !== 1 ||
    !["capture", "restore"].includes(positionals[0] ?? "") ||
    !values.destination ||
    !isAbsolute(values.destination) ||
    !values["confirm-offline"] ||
    !values["confirm-protected-destination"]
  )
    throw new Error("Invalid offline backup arguments");
  if (values.config) {
    if (!isAbsolute(values.config)) throw new Error("Absolute private config required");
    loadEnvFile(values.config);
  } else await import("../packages/config/src/env.js");
  const config = loadConfig();
  if (
    config.profile !== "local" ||
    config.databaseUrl ||
    config.artifactS3 ||
    !config.vaultKey ||
    !process.env.AUTOPILOT_BACKUP_KEY
  )
    throw new Error("Private local profile and separate backup/vault keys required");
  const input = {
    destinationParent: values.destination,
    ownerId: config.ownerId,
    vaultKey: config.vaultKey,
    backupKey: process.env.AUTOPILOT_BACKUP_KEY,
    allWritersStopped: true as const,
    protectedDestinationReviewed: true as const,
  };
  if (positionals[0] === "capture") {
    if (values.archive) throw new Error("Capture does not take an archive");
    console.log(
      JSON.stringify(
        await runOfflineBackup({
          operation: "capture",
          input: { ...input, dataDir: config.dataDir },
        }),
      ),
    );
  } else {
    if (!values.archive || !isAbsolute(values.archive))
      throw new Error("Restore requires an absolute archive");
    console.log(
      JSON.stringify(
        await runOfflineBackup({
          operation: "restore",
          input: { ...input, archivePath: values.archive },
        }),
      ),
    );
  }
} catch {
  console.error(
    "Offline backup failed. Use capture/restore, an absolute --destination, both --confirm-offline --confirm-protected-destination, a private local config and separately recoverable AUTOPILOT_BACKUP_KEY/vault keys. No runtime was started or resumed.",
  );
  process.exitCode = 1;
}
