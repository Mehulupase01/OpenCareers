import { createServerBuildContext } from "./server-context.js";

try {
  if (process.argv.length !== 2) throw new Error("Context builder accepts no options.");
  console.log(JSON.stringify(await createServerBuildContext()));
} catch {
  console.error(
    "Server context preparation failed; only screened compiled public artifacts are supported.",
  );
  process.exitCode = 1;
}
