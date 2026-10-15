import { execFile } from "node:child_process";
import { promisify } from "node:util";

const result = await promisify(execFile)(process.execPath, ["dist/scripts/runtime.js", "launch"], {
  cwd: process.cwd(),
  env: process.env,
  timeout: 5000,
  windowsHide: true,
});
console.log(JSON.parse(result.stdout).runtimePid);
