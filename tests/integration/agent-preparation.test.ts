import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AllocationClass, allocationLimits } from "../../packages/contracts/src/agents.js";
import { runPreparationGraph } from "../../packages/inference/src/graph.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { GraphRepository, graphDigest } from "../../packages/persistence/src/graph-repository.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { agentBinding, agentBudget, agentNode, agentOutput } from "../helpers/agent-fixtures.js";

for (const engine of ["sqlite", "postgres"] as const)
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} preparation isolation and allocations`,
    () => {
      let db: Database;
      let owner: string;
      let graph: GraphRepository;
      let matching: MatchingRepository;
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `agent-${randomUUID()}`;
        await new Repository(db, owner).initialize();
        graph = new GraphRepository(db, owner);
        matching = new MatchingRepository(db, owner);
        await matching.setFixtureRoute("synthetic/model:free", "synthetic-provider");
      });
      afterEach(async () => {
        await db?.close();
      });
      it("allocates 50 requests predictably without borrowing task classes or the reserve", async () => {
        for (const [key, limit] of Object.entries(allocationLimits)) {
          const purpose = key as AllocationClass;
          if (purpose === "unallocated_reserve") continue;
          for (let i = 0; i < limit; i++) {
            const reservation = await matching.reserve(
              "synthetic/model:free",
              "synthetic-provider",
              50,
              null,
              undefined,
              purpose,
            );
            await matching.markSent(reservation.id, "a".repeat(64));
            await matching.finish(reservation.id, {
              status: "completed",
              responseHash: "b".repeat(64),
            });
          }
          await expect(
            matching.reserve(
              "synthetic/model:free",
              "synthetic-provider",
              50,
              null,
              undefined,
              purpose,
            ),
          ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
        }
        expect((await matching.snapshot(50)).budget.used).toBe(42);
        for (let i = 0; i < 8; i++)
          await matching.reserve(
            "synthetic/model:free",
            "synthetic-provider",
            50,
            null,
            undefined,
            "unallocated_reserve",
          );
        expect((await matching.snapshot(50)).budget.reserved).toBe(8);
        await expect(
          matching.reserve(
            "synthetic/model:free",
            "synthetic-provider",
            50,
            null,
            undefined,
            "unallocated_reserve",
          ),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
        expect((await matching.snapshot(50)).route.status).toBe("fixture");
        const repository = new Repository(db, owner);
        await repository.enqueue({
          type: "reconcile",
          domain: "synthetic",
          dedupeKey: randomUUID(),
        });
        expect(await repository.claim("synthetic-worker", ["reconcile"])).not.toBeNull();
      });
      it("enforces class caps atomically under concurrent reservations", async () => {
        const results = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            matching.reserve("synthetic/model:free", "synthetic-provider", 50),
          ),
        );
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
      });
      it("caps active runs and expires abandoned pure work before admitting replacements", async () => {
        let clock = Date.now();
        const bounded = new GraphRepository(db, owner, () => new Date(clock));
        for (let i = 0; i < 6; i++) await bounded.start(agentBinding(), agentBudget);
        await expect(bounded.start(agentBinding(), agentBudget)).rejects.toMatchObject({
          code: "MODEL_QUOTA_EXHAUSTED",
        });
        clock += agentBudget.wallTimeMs;
        await expect(bounded.start(agentBinding(), agentBudget)).resolves.toEqual(
          expect.any(String),
        );
        expect(
          (
            await db.query(
              "SELECT COUNT(*) AS count FROM graph_runs WHERE owner_id=$1 AND state='failed'",
              [owner],
            )
          )[0]?.count,
        ).toEqual(engine === "postgres" ? "6" : 6);
      });
      it("prunes only old terminal graph records and preserves checkpoint evidence", async () => {
        await graph.checkpoint(agentBinding(), graphDigest(agentNode), agentOutput);
        await db.transaction(async (tx) => {
          for (let i = 0; i < 1002; i++) {
            const id = `old-${String(i).padStart(4, "0")}`;
            await tx.query(
              "INSERT INTO graph_runs(owner_id,id,binding,budget,state,started_at,ended_at) VALUES($1,$2,$3,$4,'completed',$5,$5)",
              [
                owner,
                id,
                JSON.stringify(agentBinding()),
                JSON.stringify(agentBudget),
                "2026-01-01T00:00:00.000Z",
              ],
            );
            await tx.query(
              "INSERT INTO graph_nodes(owner_id,run_id,ordinal,kind,state,token_cap,request_cap) VALUES($1,$2,1,'extractor','completed',1000,1)",
              [owner, id],
            );
          }
        });
        await graph.start(agentBinding(), agentBudget);
        expect(
          (await db.query("SELECT COUNT(*) AS count FROM graph_runs WHERE owner_id=$1", [owner]))[0]
            ?.count,
        ).toEqual(engine === "postgres" ? "1001" : 1001);
        expect(
          (
            await db.query("SELECT COUNT(*) AS count FROM graph_nodes WHERE owner_id=$1", [owner])
          )[0]?.count,
        ).toEqual(engine === "postgres" ? "1000" : 1000);
        expect(await graph.cached(agentBinding(), graphDigest(agentNode), "extractor")).toEqual(
          agentOutput,
        );
      });
      it("reuses only compatible pure checkpoints across fresh run IDs", async () => {
        let calls = 0;
        const handler = async () => {
          calls++;
          return { output: agentOutput, tokens: 10, requests: 1 };
        };
        const first = await runPreparationGraph(graph, agentBinding(), agentBudget, [agentNode], {
          extractor: handler,
        });
        const second = await runPreparationGraph(
          new GraphRepository(db, owner),
          agentBinding(),
          agentBudget,
          [agentNode],
          { extractor: handler },
        );
        expect(first.runId).not.toBe(second.runId);
        expect(calls).toBe(1);
        await runPreparationGraph(
          graph,
          { ...agentBinding(), promptVersion: "prompt-v2" },
          agentBudget,
          [agentNode],
          { extractor: handler },
        );
        expect(calls).toBe(2);
        expect(await db.query("SELECT id FROM applications WHERE owner_id=$1", [owner])).toEqual(
          [],
        );
        expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toEqual([]);
      });
      it("fails closed on corrupted or cross-owner checkpoints", async () => {
        await graph.checkpoint(agentBinding(), graphDigest(agentNode), agentOutput);
        const other = `agent-${randomUUID()}`;
        await new Repository(db, other).initialize();
        expect(
          await new GraphRepository(db, other).cached(
            agentBinding(),
            graphDigest(agentNode),
            "extractor",
          ),
        ).toBeNull();
        await db.query("UPDATE graph_checkpoints SET sha256=$1 WHERE owner_id=$2", [
          "0".repeat(64),
          owner,
        ]);
        await expect(
          graph.cached(agentBinding(), graphDigest(agentNode), "extractor"),
        ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
      });
      it("prevents node overrun and late completion from checkpointing", async () => {
        await expect(
          runPreparationGraph(graph, agentBinding(), agentBudget, [agentNode], {
            extractor: async () => ({ output: agentOutput, tokens: 1001, requests: 1 }),
          }),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
        expect(await graph.cached(agentBinding(), graphDigest(agentNode), "extractor")).toBeNull();
        await expect(
          runPreparationGraph(
            graph,
            agentBinding(),
            { ...agentBudget, wallTimeMs: 20 },
            [agentNode],
            {
              extractor: async () =>
                new Promise((resolve) =>
                  setTimeout(() => resolve({ output: agentOutput, tokens: 10, requests: 1 }), 100),
                ),
            },
          ),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
        await new Promise((resolve) => setTimeout(resolve, 110));
        expect(await graph.cached(agentBinding(), graphDigest(agentNode), "extractor")).toBeNull();
      });
      it("does not let a handler mutate the evidence used for validation", async () => {
        await expect(
          runPreparationGraph(graph, agentBinding(), agentBudget, [agentNode], {
            extractor: async (node) => {
              node.input.description = "Fabricated";
              return {
                output: {
                  kind: "extractor",
                  requirements: [{ text: "Fabricated", start: 0, end: 10 }],
                },
                tokens: 10,
                requests: 1,
              };
            },
          }),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        expect(await graph.cached(agentBinding(), graphDigest(agentNode), "extractor")).toBeNull();
      });
      it("enforces run step and request caps before invoking another node", async () => {
        const analyst = { ...agentNode, kind: "match_analyst" as const };
        for (const limited of [
          { ...agentBudget, steps: 1 },
          { ...agentBudget, requests: 1 },
        ]) {
          const id = await graph.start(agentBinding([agentNode, analyst]), limited);
          const slot = await graph.reserveNode(id, "extractor");
          await graph.completeNode(id, slot.ordinal, agentOutput, { tokens: 10, requests: 1 });
          await expect(graph.reserveNode(id, "match_analyst")).rejects.toMatchObject({
            code: "MODEL_QUOTA_EXHAUSTED",
          });
          await graph.finish(id, "failed");
        }
      });
    },
  );
