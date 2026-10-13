import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { processCensusEnvironment, readProcessMemory } from "./owned-processes.js";

const execute = promisify(execFile);
if (process.platform !== "win32" || process.argv.length !== 2)
  throw new Error("Windows-only bounded synthetic census diagnostic.");
const environment = processCensusEnvironment();
const narrow = Object.fromEntries(
  Object.entries(environment).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|HOME|USERPROFILE)$/i.test(key),
  ),
);
const observations = [];
for (const [name, env] of [
  ["previous_os_subset", narrow],
  ["launcher_os_subset", environment],
] as const) {
  const started = performance.now();
  let status = "passed";
  try {
    const result = await execute(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[Console]::WriteLine('ready')"],
      { env, windowsHide: true, timeout: 20000, maxBuffer: 1024 },
    );
    if (result.stdout.trim() !== "ready") status = "unexpected_output";
  } catch {
    status = "failed_or_timed_out";
  }
  observations.push({
    phase: "powershell_startup",
    environment: name,
    status,
    elapsedMs: performance.now() - started,
  });
}
const started = performance.now();
let census = "passed";
let lastCompletedPhase: string | null = null;
let helperKilled = false;
try {
  await readProcessMemory();
  lastCompletedPhase = "serialized";
} catch (error) {
  census = "failed_or_timed_out";
  const phases = new Set([
    "started",
    "utility_loaded",
    "compiled",
    "snapshot_created",
    "enumerated",
    "serialized",
  ]);
  if (error && typeof error === "object") {
    helperKilled = "killed" in error && error.killed === true;
    if ("stderr" in error && typeof error.stderr === "string")
      for (const line of error.stderr.split(/\r?\n/))
        if (line.startsWith("oc-census:") && phases.has(line.slice("oc-census:".length)))
          lastCompletedPhase = line.slice("oc-census:".length);
  }
}
observations.push({
  phase: "process_census",
  environment: "launcher_os_subset",
  status: census,
  lastCompletedPhase,
  helperKilled,
  elapsedMs: performance.now() - started,
});
const directory = join(process.cwd(), "test-results", "process-census-diagnostic");
await mkdir(directory, { recursive: true });
const evidence = {
  platform: process.platform,
  nodeVersion: process.version,
  helperDeadlineMs: 20000,
  observations,
  recordsRetained: false,
  environmentValuesRetained: false,
};
await writeFile(join(directory, "timing.json"), JSON.stringify(evidence), { mode: 0o600 });
console.log(JSON.stringify(evidence));
// Contract tests remain authoritative; this probe never substitutes a pass for them.
