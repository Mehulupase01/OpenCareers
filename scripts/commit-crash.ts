import { runCommitCrashMatrix } from "./commit-crash-run.js";

try {
  if (process.argv.length !== 2) throw new Error("Synthetic crash matrix accepts no options");
  console.log(JSON.stringify(await runCommitCrashMatrix()));
} catch {
  console.error("Owned synthetic commit crash matrix failed; no private runtime was accessed.");
  process.exitCode = 1;
}
