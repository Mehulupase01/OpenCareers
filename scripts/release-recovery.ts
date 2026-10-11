import { runReleaseRecovery } from "./release-recovery-run.js";

try {
  if (process.argv.length !== 2) throw new Error("Recovery demonstration accepts no options.");
  console.log(JSON.stringify(await runReleaseRecovery()));
} catch {
  console.error("Recovery demonstration failed; only fresh synthetic mock storage is supported.");
  process.exitCode = 1;
}
