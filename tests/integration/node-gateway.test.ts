import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeInput } from "../../packages/contracts/src/agents.js";
import { runPreparationGraph } from "../../packages/inference/src/graph.js";
import {
  createPreparationNodeHandler,
  productionGraphEnabled,
} from "../../packages/inference/src/node-gateway.js";
import { OpenRouterTransport } from "../../packages/inference/src/transport.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { GraphRepository } from "../../packages/persistence/src/graph-repository.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { documentFacts } from "../fixtures/document-packets.js";
import { agentBinding, agentBudget, agentNode, agentOutput } from "../helpers/agent-fixtures.js";
import { syntheticCatalogue, syntheticRoutePolicy } from "../helpers/route-fixtures.js";

const model = "synthetic/model:free";
const provider = "synthetic-provider";
const node: NodeInput = {
  ...agentNode,
  input: { ...agentNode.input, facts: [{ id: "fact-python", revision: 1, text: "Python" }] },
};
for (const engine of ["sqlite", "postgres"] as const)
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} preparation gateway`,
    () => {
      let db: Database;
      let ledger: MatchingRepository;
      let graph: GraphRepository;
      let owner: string;
      beforeEach(async () => {
        db =
          engine === "postgres"
            ? await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string)
            : await openSqlite(":memory:");
        await migrate(db);
        owner = `node-${randomUUID()}`;
        await new Repository(db, owner).initialize();
        ledger = new MatchingRepository(db, owner);
        graph = new GraphRepository(db, owner);
        await ledger.setRoute(syntheticCatalogue(model), {
          eligible: true,
          modelId: model,
          provider,
          reasons: [],
          catalogueFetchedAt: new Date().toISOString(),
        });
      });
      afterEach(async () => {
        await db?.close();
      });
      it("charges one class allocation, minimizes disclosure and reuses validated checkpoints", async () => {
        expect(productionGraphEnabled).toBe(false);
        const complete = vi.fn(async (request) => {
          const body = JSON.stringify(request.messages);
          expect(body).not.toContain("contact@synthetic.example");
          expect(body).not.toContain("Visa expires");
          expect(request).not.toHaveProperty("tools");
          return {
            model,
            provider,
            content: JSON.stringify(agentOutput),
            usage: { promptTokens: 10, completionTokens: 2 },
          };
        });
        const input = structuredClone(node);
        input.input.description += " Contact contact@synthetic.example. Visa expires tomorrow.";
        const handler = createPreparationNodeHandler(ledger, 50, { complete }, documentFacts);
        await runPreparationGraph(graph, agentBinding([input]), agentBudget, [input], {
          extractor: handler,
        });
        await runPreparationGraph(graph, agentBinding([input]), agentBudget, [input], {
          extractor: handler,
        });
        expect(complete).toHaveBeenCalledOnce();
        expect((await ledger.snapshot(50)).budget.used).toBe(1);
        expect(
          (
            await db.query(
              "SELECT allocation_class,state FROM inference_reservations WHERE owner_id=$1",
              [owner],
            )
          )[0],
        ).toMatchObject({ allocation_class: "semantic_triage", state: "completed" });
        expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toEqual([]);
      });
      it("uses isolated critique and repair allocations for typed proposals", async () => {
        const critic: NodeInput = {
          ...node,
          kind: "critic",
          input: {
            ...node.input,
            claims: [{ text: "Invented experience", factIds: ["fact-python"] }],
          },
        };
        const repair: NodeInput = { ...critic, kind: "repair" };
        const handler = createPreparationNodeHandler(
          ledger,
          50,
          {
            complete: async (request) => ({
              model,
              provider,
              content: JSON.stringify(
                request.response_format.json_schema.name.endsWith("critic")
                  ? { kind: "critic", issues: [{ claimIndex: 0, code: "unsupported_claim" }] }
                  : { kind: "repair", claims: [{ text: "Python", factIds: ["fact-python"] }] },
              ),
              usage: { promptTokens: 10, completionTokens: 2 },
            }),
          },
          documentFacts,
        );
        const result = await runPreparationGraph(
          graph,
          agentBinding([critic, repair]),
          agentBudget,
          [critic, repair],
          { critic: handler, repair: handler },
        );
        expect(result.outputs).toHaveLength(2);
        const classes = await db.query(
          "SELECT allocation_class,state FROM inference_reservations WHERE owner_id=$1 ORDER BY allocation_class",
          [owner],
        );
        expect(classes).toEqual([
          { allocation_class: "independent_critique", state: "completed" },
          { allocation_class: "repairs", state: "completed" },
        ]);
      });
      it("counts failed sent calls and never checkpoints token overruns", async () => {
        const handler = createPreparationNodeHandler(
          ledger,
          50,
          {
            complete: async () => ({
              model,
              provider,
              content: JSON.stringify(agentOutput),
              usage: { promptTokens: 1001, completionTokens: 2 },
            }),
          },
          documentFacts,
        );
        await expect(
          runPreparationGraph(graph, agentBinding([node]), agentBudget, [node], {
            extractor: handler,
          }),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
        expect((await ledger.snapshot(50)).budget.used).toBe(1);
        expect(
          (await db.query("SELECT state FROM inference_reservations WHERE owner_id=$1", [owner]))[0]
            ?.state,
        ).toBe("failed");
        expect(
          await db.query("SELECT cache_key FROM graph_checkpoints WHERE owner_id=$1", [owner]),
        ).toEqual([]);
      });
      it("rejects fabricated, private or stale evidence before inference", async () => {
        const complete = vi.fn();
        const handler = createPreparationNodeHandler(ledger, 50, { complete }, documentFacts);
        for (const changed of [
          { ...node.input.facts[0], text: "Fabricated services" },
          { id: "fact-identity", revision: 1, text: "Zo" },
          { id: "fact-python", revision: 2, text: "Python" },
        ]) {
          const input = { ...node, input: { ...node.input, facts: [changed] } } as NodeInput;
          await expect(
            handler(input, {
              maxTokens: 1000,
              maxRequests: 1,
              signal: new AbortController().signal,
            }),
          ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        }
        expect(complete).not.toHaveBeenCalled();
        expect((await ledger.snapshot(50)).budget.used).toBe(0);
      });
      it("does not expand reviewed privacy purposes to novel form answers", async () => {
        const handler = createPreparationNodeHandler(
          ledger,
          50,
          { complete: vi.fn() },
          documentFacts,
          "reviewed-career-facts-v1",
        );
        await expect(
          handler(
            { ...node, kind: "form_answer_planner" },
            { maxTokens: 1000, maxRequests: 1, signal: new AbortController().signal },
          ),
        ).rejects.toMatchObject({ code: "MODEL_ROUTE_INELIGIBLE" });
      });
    },
  );

it("propagates cancellation through catalogue checks and never dispatches a late POST", async () => {
  const calls: string[] = [];
  const transport = new OpenRouterTransport(
    "synthetic-key",
    async (url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      calls.push(String(url));
      await new Promise((resolve) => setTimeout(resolve, 30));
      return Response.json(syntheticCatalogue(model));
    },
    "strict-zdr-v1",
    syntheticRoutePolicy(model, provider),
  );
  const { buildRequest } = await import("../../packages/inference/src/gateway.js");
  const { matchingEvaluationCases } = await import("../fixtures/matching-evaluation.js");
  const fixture = matchingEvaluationCases[0];
  if (!fixture) throw new Error("Missing synthetic fixture.");
  await expect(
    transport.complete(buildRequest(fixture.input, model, provider), AbortSignal.timeout(10)),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatch(/\/models$/);
});
