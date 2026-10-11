import { importRegressionFixture } from "./regression-import.js";

const args = process.argv.slice(2);
try {
  if (args.length !== 2 || args[1] !== "--publish-reviewed" || !args[0])
    throw new Error("Invalid arguments.");
  console.log(JSON.stringify(await importRegressionFixture(process.cwd(), args[0], true)));
} catch {
  console.error(
    "Regression import refused. Supply one bounded, reviewed, categorical correction file and --publish-reviewed.",
  );
  process.exitCode = 1;
}
