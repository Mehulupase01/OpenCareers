import { buildWindowsBundle } from "./windows-bundle.js";

try {
  if (process.argv.length !== 2) throw new Error("No private path or option is accepted.");
  console.log(JSON.stringify(await buildWindowsBundle()));
} catch {
  console.error(
    "Windows bundle failed. Check the build, artifact types and private-data screening.",
  );
  process.exitCode = 1;
}
