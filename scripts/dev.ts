import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const children: Array<{ name: string; process: ChildProcess }> = [];
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.process.kill("SIGTERM");
}

function start(name: string, args: string[]) {
  const child = spawn(process.execPath, args, { stdio: "inherit", windowsHide: true });
  children.push({ name, process: child });
  child.on("error", (error) => {
    console.error(`${name} failed to start:`, error);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${name} exited unexpectedly (${signal ?? code}).`);
      stop(code ?? 1);
    }
  });
  return child;
}

async function waitForApi(api: ChildProcess) {
  const host = process.env.AUTOPILOT_HOST ?? "127.0.0.1";
  const port = process.env.AUTOPILOT_PORT ?? "4317";
  const endpoint = `http://${host === "::1" ? "[::1]" : host}:${port}/health/ready`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (api.exitCode !== null || api.signalCode) throw new Error("API exited during startup.");
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The API owns schema initialization; dependents wait until it is ready.
    }
    await setTimeout(100);
  }
  throw new Error("API did not become ready within 10 seconds.");
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

try {
  const api = start("api", ["--import", "tsx", "apps/api/src/main.ts"]);
  await waitForApi(api);
  start("worker", ["--import", "tsx", "apps/worker/src/main.ts"]);
  start("vite", [resolve("node_modules/vite/bin/vite.js"), "--config", "apps/web/vite.config.ts"]);
} catch (error) {
  console.error("Development services failed to initialize:", error);
  stop(1);
}
