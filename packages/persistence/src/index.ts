import { mkdir, readdir, readFile, realpath, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Config } from "../../config/src/index.js";
import { openPostgres, openSqlite } from "./database.js";
import { migrate } from "./migrations.js";
import { Repository } from "./repository.js";

const demoMarkerValue = "OpenCareers synthetic data v1";

export async function ensureDemoMarker(dataDir: string): Promise<void> {
  const marker = join(dataDir, ".synthetic-workspace");
  const lock = join(dataDir, ".synthetic-workspace-initializing");
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await readFile(marker, "utf8")).trim() !== demoMarkerValue)
        throw new Error("Demo marker invalid; refusing to open unknown data.");
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    try {
      await mkdir(lock);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      await setTimeout(25);
      continue;
    }
    try {
      try {
        if ((await readFile(marker, "utf8")).trim() !== demoMarkerValue)
          throw new Error("Demo marker invalid; refusing to open unknown data.");
        return;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const contents = await readdir(dataDir);
      if (contents.some((name) => name !== ".synthetic-workspace-initializing"))
        throw new Error("Demo marker missing; refusing to open unknown data.");
      await writeFile(marker, `${demoMarkerValue}\n`, { flag: "wx" });
      return;
    } finally {
      await rmdir(lock);
    }
  }
  throw new Error("Demo marker initialization timed out.");
}

export async function connect(config: Config): Promise<Repository> {
  await mkdir(config.dataDir, { recursive: true });
  const physical = await realpath(config.dataDir);
  const lexical = resolve(config.dataDir);
  const same =
    process.platform === "win32"
      ? physical.toLowerCase() === lexical.toLowerCase()
      : physical === lexical;
  if (!same) throw new Error("Data directory must not be redirected by a symlink or junction.");
  if (config.profile === "demo") await ensureDemoMarker(config.dataDir);
  const db = config.databaseUrl
    ? await openPostgres(config.databaseUrl)
    : await openSqlite(join(config.dataDir, "opencareers.sqlite"));
  try {
    await migrate(db);
    const repository = new Repository(db, config.ownerId);
    await repository.initialize();
    return repository;
  } catch (error) {
    await db.close();
    throw error;
  }
}
