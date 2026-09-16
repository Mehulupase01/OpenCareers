import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Config } from "../../config/src/index.js";
import { openPostgres, openSqlite } from "./database.js";
import { migrate } from "./migrations.js";
import { Repository } from "./repository.js";

export async function connect(config: Config): Promise<Repository> {
  await mkdir(config.dataDir, { recursive: true });
  const physical = await realpath(config.dataDir);
  const lexical = resolve(config.dataDir);
  const same =
    process.platform === "win32"
      ? physical.toLowerCase() === lexical.toLowerCase()
      : physical === lexical;
  if (!same) throw new Error("Data directory must not be redirected by a symlink or junction.");
  if (config.profile === "demo") {
    const marker = join(config.dataDir, ".synthetic-workspace");
    const contents = await readdir(config.dataDir);
    if (!contents.length) {
      await writeFile(marker, "OpenCareers synthetic data v1\n", { flag: "wx" }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
    }
    if ((await readFile(marker, "utf8")).trim() !== "OpenCareers synthetic data v1")
      throw new Error("Demo marker missing; refusing to open unknown data.");
  }
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
