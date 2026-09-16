import { spawn } from "node:child_process";
import { resolve } from "node:path";

const children = [
  ["--import", "tsx", "apps/api/src/main.ts"],
  ["--import", "tsx", "apps/worker/src/main.ts"],
  [resolve("node_modules/vite/bin/vite.js"), "--config", "apps/web/vite.config.ts"],
].map((args) => spawn(process.execPath, args, { stdio: "inherit", windowsHide: true }));
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
