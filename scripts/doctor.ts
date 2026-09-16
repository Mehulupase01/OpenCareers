import "../packages/config/src/env.js";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, statfs } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { loadConfig } from "../packages/config/src/index.js";
import { connect } from "../packages/persistence/src/index.js";

try {
  const config = loadConfig();
  await mkdir(config.dataDir, { recursive: true });
  await access(config.dataDir, constants.R_OK | constants.W_OK);
  const disk = await statfs(config.dataDir);
  const repository = await connect(config);
  const engine =
    repository.db.dialect === "sqlite"
      ? (await repository.db.query("SELECT sqlite_version() AS version"))[0]?.version
      : (await repository.db.query("SHOW server_version"))[0]?.server_version;
  await repository.db.close();
  let browserAvailable = true;
  try {
    await access(chromium.executablePath());
  } catch {
    browserAvailable = false;
  }
  const lockHash = createHash("sha256")
    .update(await readFile("pnpm-lock.yaml"))
    .digest("hex");
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        profile: config.profile,
        database: {
          backend: config.databaseUrl ? "postgres" : "sqlite",
          version: engine,
          connected: true,
        },
        writable: true,
        freeDiskBytes: disk.bavail * disk.bsize,
        browser: { available: browserAvailable, version: "1.63.0" },
        documentRenderer: "not_implemented",
        privateCredentialConfigured: Boolean(config.ownerToken),
        externalSubmissionEnabled: false,
        lockSha256: lockHash,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message.replace(/postgresql:\/\/[^\s]+/g, "[REDACTED]")
      : "Diagnostics failed.",
  );
  process.exitCode = 1;
}
