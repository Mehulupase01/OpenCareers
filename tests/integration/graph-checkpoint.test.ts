import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runPreparationGraph } from "../../packages/inference/src/graph.js";
import { openPostgres, openSqlite } from "../../packages/persistence/src/database.js";
import { GraphRepository } from "../../packages/persistence/src/graph-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { agentBinding, agentBudget, agentNode, agentOutput } from "../helpers/agent-fixtures.js";

for (const engine of ["sqlite", "postgres"] as const)
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} graph process recovery`,
    () => {
      it("reconstructs pure work after SIGKILL without changing an existing attempt", async () => {
        const dir = await mkdtemp(join(tmpdir(), "opencareers-graph-"));
        const location =
          engine === "postgres"
            ? (process.env.AUTOPILOT_TEST_DATABASE_URL as string)
            : join(dir, "graph.sqlite");
        const owner = `graph-${randomUUID()}`;
        const db =
          engine === "postgres" ? await openPostgres(location) : await openSqlite(location);
        let child: ReturnType<typeof fork> | undefined;
        try {
          await migrate(db);
          const repository = new Repository(db, owner);
          await repository.initialize();
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
          const app = await repository.createApplication("job", "candidate");
          const at = new Date().toISOString();
          await db.query(
            "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES('policy',$1,1,'{}',$2,'2027-01-01T00:00:00.000Z')",
            [owner, at],
          );
          await db.query(
            "INSERT INTO packets(id,owner_id,application_id,manifest,sha256,created_at) VALUES('packet',$1,$2,'{}','synthetic',$3)",
            [owner, app.id, at],
          );
          await db.query(
            "INSERT INTO intents(id,owner_id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES('synthetic-intent',$1,$2,'packet','policy','{}','synthetic',$3)",
            [owner, app.id, at],
          );
          await db.query(
            "INSERT INTO attempts(id,owner_id,application_id,intent_id,fence,state,started_at) VALUES('synthetic-attempt',$1,$2,'synthetic-intent',1,'UNKNOWN',$3)",
            [owner, app.id, new Date().toISOString()],
          );
          const before = await db.query("SELECT * FROM attempts WHERE owner_id=$1", [owner]);
          child = fork(
            fileURLToPath(new URL("../helpers/graph-crash-worker.ts", import.meta.url)),
            [engine, location, owner],
            { execArgv: ["--import", "tsx"], silent: true },
          );
          const [message] = await once(child, "message");
          expect(message.type).toBe("checkpointed");
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await exited;
          let calls = 0;
          const handlers = {
            extractor: async () => {
              calls++;
              return { output: agentOutput, tokens: 10, requests: 1 };
            },
          };
          const graph = new GraphRepository(db, owner);
          const recovered = await runPreparationGraph(
            graph,
            agentBinding(),
            agentBudget,
            [agentNode],
            handlers,
          );
          expect(recovered.runId).not.toBe(message.runId);
          expect(calls).toBe(0);
          await runPreparationGraph(
            graph,
            { ...agentBinding(), schemaVersion: "schema-v2" },
            agentBudget,
            [agentNode],
            handlers,
          );
          expect(calls).toBe(1);
          expect(await db.query("SELECT * FROM attempts WHERE owner_id=$1", [owner])).toEqual(
            before,
          );
          expect(
            (
              await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
                owner,
                app.id,
              ])
            )[0]?.state,
          ).toBe(app.state);
        } finally {
          if (child && child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGKILL");
            await exited;
          }
          await db.close();
          await rm(dir, { recursive: true, force: true });
        }
      }, 30000);
    },
  );
