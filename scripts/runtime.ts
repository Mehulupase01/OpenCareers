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
  else if (command === "status" || command === "stop")
    console.log(JSON.stringify(await runtimeCommand(config, command)));
  else if (command === "validate")
    console.log(
      JSON.stringify({
        profile: config.profile,
        inferenceEnabled: config.inference.enabled,
        externalSubmissionEnabled: config.externalSubmissionEnabled,
      }),
    );
  else throw new Error("Expected start, status, stop or validate.");
} catch {
  console.error(
    "Managed runtime failed. Check configuration, build, control ownership and bounded runtime metadata; no submission is replayed.",
  );
  process.exitCode = 1;
}
