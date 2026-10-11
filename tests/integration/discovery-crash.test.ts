import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { DiscoveryYield, pollResumable } from "../../packages/discovery/src/resumable.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import { openPostgres, openSqlite } from "../../packages/persistence/src/database.js";
import { DiscoveryScanRepository } from "../../packages/persistence/src/discovery-scan-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { leverFixture, sourceFixture } from "../helpers/discovery-fixtures.js";

for (const engine of ["sqlite", "postgres"] as const)
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} public scan process recovery`,
    () => {
      it("recovers committed reads after SIGKILL and fences the expired process lease", async () => {
        const dir = await mkdtemp(join(tmpdir(), "opencareers-scan-crash-"));
        const location =
          engine === "postgres"
            ? (process.env.AUTOPILOT_TEST_DATABASE_URL as string)
            : join(dir, "scan.sqlite");
        const owner = `scan-crash-${randomUUID()}`;
        const db =
          engine === "postgres" ? await openPostgres(location) : await openSqlite(location);
        let child: ReturnType<typeof fork> | undefined;
        try {
          await migrate(db);
          await new CandidateRepository(db, owner).initialize();
          await new DiscoveryScanRepository(db, owner).saveSource({
            ...sourceInputSchema.strip().parse(sourceFixture),
            id: undefined,
            expectedRevision: 0,
            connector: "lever",
          });
          child = fork(
            fileURLToPath(new URL("../helpers/discovery-crash-worker.ts", import.meta.url)),
            [engine, location, owner],
            { execArgv: ["--import", "tsx"], silent: true },
          );
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          let message: { type: string; sourceId: string };
          try {
            [message] = await once(child, "message", { signal: controller.signal });
          } finally {
            clearTimeout(timeout);
          }
          expect(message.type).toBe("checkpointed");
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await exited;
          const clock = () => new Date(Date.now() + 91000);
          const repo = new DiscoveryScanRepository(db, owner, clock);
          const source = await repo.claimSource();
          if (!source) throw new Error("Synthetic expired lease was not reclaimable.");
          expect(await repo.loadScan(source)).toHaveLength(2);
          const calls: number[] = [];
          await expect(
            pollResumable(
              repo,
              source,
              async (url) => {
                const offset = Number(new URL(url).searchParams.get("skip"));
                calls.push(offset);
                return {
                  status: 200,
                  body: JSON.stringify(leverFixture(offset, offset < 200 ? 100 : 1)),
                  etag: null,
                  retryAfter: null,
                };
              },
              { maxReads: 2, clock },
            ),
          ).rejects.toBeInstanceOf(DiscoveryYield);
          expect(calls).toEqual([0, 200]);
          expect(await db.query("SELECT * FROM jobs WHERE owner_id=$1", [owner])).toHaveLength(0);
          expect(await db.query("SELECT * FROM attempts WHERE owner_id=$1", [owner])).toHaveLength(
            0,
          );
        } finally {
          if (child && child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGKILL");
            await exited;
          }
          await db.close();
          await rm(dir, { recursive: true, force: true });
        }
      }, 20000);
    },
  );
