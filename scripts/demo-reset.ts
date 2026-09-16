import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../packages/config/src/index.js";

const config = loadConfig();
const target = resolve(process.cwd(), ".data/demo");
if (config.profile !== "demo" || config.dataDir !== target)
  throw new Error("Reset is restricted to the synthetic workspace.");
const marker = resolve(target, ".synthetic-workspace");
if (existsSync(target)) {
  if (
    (await realpath(target)) !== target ||
    (await readFile(marker, "utf8")).trim() !== "OpenCareers synthetic data v1"
  )
    throw new Error("Missing synthetic marker or redirected data path; reset refused.");
  const archive = `${target}-backup-${Date.now()}`;
  await rename(target, archive);
  console.log(`Previous synthetic data preserved at ${archive}`);
}
await mkdir(dirname(marker), { recursive: true });
await writeFile(marker, "OpenCareers synthetic data v1\n", { flag: "wx" });
console.log("Synthetic workspace reset. Restart the dev processes.");
