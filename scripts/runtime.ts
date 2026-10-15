import { isAbsolute } from "node:path";
import { loadEnvFile } from "node:process";
import { runManagedRuntime, runtimeCommand } from "../apps/worker/src/managed-runtime.js";
import { loadConfig } from "../packages/config/src/index.js";

try {
  const command = process.argv[2] ?? "start";
  if (process.argv[3]) {
    if (
      process.argv[3] !== "--config" ||
      !process.argv[4] ||
      !isAbsolute(process.argv[4]) ||
      process.argv.length !== 5
    )
      throw new Error("Expected an absolute private config file.");
    loadEnvFile(process.argv[4]);
    process.env.AUTOPILOT_SKIP_ENV_FILE = "1";
  } else await import("../packages/config/src/env.js");
  const config = loadConfig();
  if (command === "start") await runManagedRuntime(config, process.cwd(), process.env);
  else if (command === "launch") {
    if (config.profile === "server" || !import.meta.filename.endsWith(".js"))
      throw new Error("Detached launch requires a compiled local installation.");
    const child = spawn(
      process.execPath,
      [import.meta.filename, "start", ...process.argv.slice(3)],
      {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    const runtimePid = child.pid;
    child.unref();
    if (!runtimePid) throw new Error("Detached runtime has no process identity.");
    console.log(JSON.stringify({ runtimePid }));
  } else if (command === "status" || command === "stop")
    console.log(JSON.stringify(await runtimeCommand(config, command)));
  else if (command === "validate")
    console.log(
      JSON.stringify({
        profile: config.profile,
        inferenceEnabled: config.inference.enabled,
        externalSubmissionEnabled: config.externalSubmissionEnabled,
      }),
    );
  else throw new Error("Expected start, launch, status, stop or validate.");
} catch {
  console.error(
    "Managed runtime failed. Check configuration, build, control ownership and bounded runtime metadata; no submission is replayed.",
  );
  process.exitCode = 1;
}

import { spawn } from "node:child_process";
