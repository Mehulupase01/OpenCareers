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
      for (const mode of ["domains", "application"] as const) {
        it(`enforces ${mode} exclusion across four simultaneous processes`, async () => {
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
            let applicationId: string | undefined;
            if (mode === "application") {
              await repository.setControl({ submissionsPaused: false });
              await repository.putJob({
                id: "job",
                employerId: "employer",
                requisitionId: "req",
                title: "Synthetic role",
                company: "Synthetic Co",
                location: "NL",
                url: "https://synthetic.example",
                description: "Fixture",
                source: "fixture",
                synthetic: true,
              });
              applicationId = (await repository.createApplication("job", "candidate")).id;
            }
            for (let i = 0; i < 12; i++)
              await repository.enqueue({
                type: mode === "application" ? "submit" : "prepare",
                domain:
                  mode === "application" ? `${i}.example` : i % 2 ? "one.example" : "two.example",
                dedupeKey: `item-${i}`,
                ...(applicationId ? { applicationId } : {}),
              });
            const readiness: Promise<unknown>[] = [];
            for (let i = 0; i < 4; i++) {
              const child = fork(
                fileURLToPath(new URL("../helpers/claim-worker.ts", import.meta.url)),
                [
                  engine,
                  location,
                  owner,
                  instant,
                  mode === "application" ? "claim-submit" : "claim-prepare",
                ],
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
            const expected = mode === "application" ? 1 : 2;
            expect(claims).toHaveLength(expected);
            expect(new Set(claims.map((t) => t.domain)).size).toBe(expected);
            expect(new Set(claims.map((t) => t.fence)).size).toBe(expected);
            if (applicationId) {
              expect(claims[0]?.applicationId).toBe(applicationId);
              expect(
                Number(
                  (
                    await db.query(
                      "SELECT commit_fence FROM applications WHERE owner_id=$1 AND id=$2",
                      [owner, applicationId],
                    )
                  )[0]?.commit_fence,
                ),
              ).toBe(claims[0]?.fence);
            }
            expect(
              (await repository.summary("demo")).tasks.filter((t) => t.state === "leased"),
            ).toHaveLength(expected);
          } finally {
            for (const child of children) if (child.exitCode === null) child.kill();
            await db.close();
            await rm(dir, { recursive: true, force: true });
          }
        }, 30000);
      }
    },
  );
}
