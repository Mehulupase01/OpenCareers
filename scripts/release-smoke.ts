import { runReleaseSmoke } from "./release-smoke-run.js";

try {
  if (process.argv.length !== 2) throw new Error("No self-test options are accepted.");
  console.log(JSON.stringify(await runReleaseSmoke()));
} catch {
  console.error("Release self-test failed; only fresh synthetic mock storage is supported.");
  process.exitCode = 1;
}
