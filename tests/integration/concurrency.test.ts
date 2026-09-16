import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Task } from "../../packages/contracts/src/index.js";
import { openPostgres, openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

function message(child: ChildProcess, type: string): Promise<{ task: Task | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Worker ${type} timeout`));
    }, 20000);
    const onMessage = (value: { type: string; task: Task | null }) => {
      if (value.type === type) {
        cleanup();
        resolve(value);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`Worker exited before ${type}`));
    };
    function cleanup() {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    }
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} multiprocess locking`,
    () => {
      it("admits only one worker per domain with two total across four simultaneous processes", async () => {
        const dir = await mkdtemp(join(tmpdir(), "opencareers-race-"));
        const location =
          engine === "postgres"
            ? (process.env.AUTOPILOT_TEST_DATABASE_URL as string)
            : join(dir, "race.sqlite");
        const owner = `race-${randomUUID()}`;
        const instant = "2026-09-16T10:00:00.000Z";
        const db =
          engine === "postgres" ? await openPostgres(location) : await openSqlite(location);
        const children: ChildProcess[] = [];
        try {
          await migrate(db);
          const repository = new Repository(db, owner, () => new Date(instant));
          await repository.initialize();
          for (let i = 0; i < 12; i++)
            await repository.enqueue({
              type: "prepare",
              domain: i % 2 ? "one.example" : "two.example",
              dedupeKey: `item-${i}`,
            });
          const readiness: Promise<unknown>[] = [];
          for (let i = 0; i < 4; i++) {
            const child = fork(
              fileURLToPath(new URL("../helpers/claim-worker.ts", import.meta.url)),
              [engine, location, owner, instant],
              { execArgv: ["--import", "tsx"], silent: true },
            );
            children.push(child);
            readiness.push(message(child, "ready"));
          }
          await Promise.all(readiness);
          const results = children.map((child) => message(child, "claimed"));
          const exits = children.map((child) => once(child, "exit"));
          for (const child of children) child.send("claim");
          const claims = (await Promise.all(results)).flatMap((r) => (r.task ? [r.task] : []));
          await Promise.all(exits);
          expect(claims).toHaveLength(2);
          expect(new Set(claims.map((t) => t.domain)).size).toBe(2);
          expect(new Set(claims.map((t) => t.fence)).size).toBe(2);
          expect(
            (await repository.summary("demo")).tasks.filter((t) => t.state === "leased"),
          ).toHaveLength(2);
        } finally {
          for (const child of children) if (child.exitCode === null) child.kill();
          await db.close();
          await rm(dir, { recursive: true, force: true });
        }
      }, 30000);
    },
  );
}
