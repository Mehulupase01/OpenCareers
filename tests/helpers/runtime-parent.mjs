import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/scripts/runtime.js", "start"], {
  cwd: process.cwd(),
  env: process.env,
  detached: true,
  windowsHide: true,
  stdio: "ignore",
});
child.on("error", () => {
  process.exitCode = 1;
});
console.log(child.pid);
child.unref();
