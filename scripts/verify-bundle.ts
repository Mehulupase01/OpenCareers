import { resolve } from "node:path";
import { verifyWindowsBundle } from "./bundle-verification.js";

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--manifest-sha256"))
    throw new Error("Unsupported verification arguments.");
  console.log(
    JSON.stringify(await verifyWindowsBundle(resolve(import.meta.dirname, "../.."), args[1])),
  );
} catch {
  console.error("Bundle verification failed. Distributed artifacts may be incomplete or changed.");
  process.exitCode = 1;
}
