import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "../../packages/contracts/src/index.js";
import { type BatchItem, runIsolatedBatch } from "../../packages/inference/src/batch.js";
import { createPreparationBatchDispatch } from "../../packages/inference/src/batch-gateway.js";
import type { CompletionRequest } from "../../packages/inference/src/transport.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { documentFacts } from "../fixtures/document-packets.js";
import { agentNode, agentOutput } from "../helpers/agent-fixtures.js";
import { syntheticCatalogue } from "../helpers/route-fixtures.js";

const model = "synthetic/model:free";
const provider = "synthetic-provider";
const options = { maxItems: 16, maxContextBytes: 24000, maxCalls: 8, wallTimeMs: 30000 };
const budget = { requests: 8, tokens: 32000, requestTokens: 8000 };
const items: BatchItem[] = ["a", "b"].map((id) => ({
  id,
  node: {
    ...agentNode,
    input: {
      ...agentNode.input,
      jobId: `job-${id}`,
      facts: [{ id: "fact-python", revision: 1, text: "Python" }],
    },
  },
}));
const response = (content: unknown, tokens = 20) => ({
  model,
  provider,
  content: JSON.stringify(content),
  usage: { promptTokens: tokens, completionTokens: 2 },
});
const valid = (ids = ["a", "b"]) => ({
  truncated: false,
  results: ids.map((id) => ({ id, output: agentOutput })),
});

for (const engine of ["sqlite", "postgres"] as const)
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} inference batch gateway`,
    () => {
      let db: Database;
      let ledger: MatchingRepository;
      let owner: string;
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `batch-${randomUUID()}`;
        await new Repository(db, owner).initialize();
        ledger = new MatchingRepository(db, owner);
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

      it("drafts independent items in one minimized ledger-backed request without submission authority", async () => {
        const complete = vi.fn(async (request: CompletionRequest) => {
          expect(JSON.stringify(request.messages)).not.toContain("contact@synthetic.example");
          expect(JSON.stringify(request.messages)).not.toContain("Visa expires");
          expect(request).not.toHaveProperty("tools");
          return response(valid());
        });
        const input = structuredClone(items);
        if (!input[0]) throw new Error("Missing fixture.");
        input[0].node.input.description +=
          " Contact contact@synthetic.example. Visa expires tomorrow.";
        const dispatch = createPreparationBatchDispatch(
          ledger,
          50,
          { complete },
          documentFacts,
          budget,
        );
        const result = await runIsolatedBatch(input, dispatch, options);
        expect(result.calls).toBe(1);
        expect(result.results.every((item) => item.output && item.error === null)).toBe(true);
        expect(complete).toHaveBeenCalledOnce();
        expect((await ledger.snapshot(50)).budget.used).toBe(1);
        expect(await ledger.routeSamples("semantic_triage")).toEqual([
          expect.objectContaining({ accepted: true }),
        ]);
        expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toEqual([]);
      });

      it("splits a missing identity into bounded calls and accounts for the rejected envelope", async () => {
        const complete = vi.fn(async (request: CompletionRequest) => {
          const group = JSON.parse(request.messages[1]?.content ?? "[]") as { id: string }[];
          return response(valid(group.length === 2 ? ["a"] : group.map((item) => item.id)));
        });
        const result = await runIsolatedBatch(
          items,
          createPreparationBatchDispatch(ledger, 50, { complete }, documentFacts, budget),
          options,
        );
        expect(result.calls).toBe(3);
        expect(result.results.every((item) => item.error === null)).toBe(true);
        expect((await ledger.snapshot(50)).budget.used).toBe(3);
        const samples = await ledger.routeSamples("semantic_triage");
        expect(samples.filter((sample) => sample.accepted)).toHaveLength(2);
        expect(samples.filter((sample) => !sample.accepted)).toHaveLength(1);
      });

      it("quarantines cross-item career evidence without retrying the valid peer", async () => {
        const input: BatchItem[] = items.map((item, index) => ({
          ...item,
          node: {
            ...item.node,
            kind: "drafter",
            input: {
              ...item.node.input,
              facts: [
                {
                  id: index ? "fact-postgresql" : "fact-python",
                  revision: 1,
                  text: index ? "PostgreSQL" : "Python",
                },
              ],
            },
          },
        }));
        const complete = vi.fn(async () =>
          response({
            truncated: false,
            results: input.map((item) => ({
              id: item.id,
              output: {
                kind: "drafter",
                claims: [{ text: "PostgreSQL", factIds: ["fact-postgresql"] }],
              },
            })),
          }),
        );
        const result = await runIsolatedBatch(
          input,
          createPreparationBatchDispatch(ledger, 50, { complete }, documentFacts, budget),
          options,
        );
        expect(result.results[0]).toMatchObject({ id: "a", output: null, error: "invalid_output" });
        expect(result.results[1]?.error).toBeNull();
        expect(complete).toHaveBeenCalledOnce();
        expect(await ledger.routeSamples("packet_drafting")).toEqual([
          expect.objectContaining({ accepted: false }),
        ]);
      });

      it("defers after exhausted request allowance rather than replaying a bad envelope", async () => {
        const complete = vi.fn(async () => response(valid(["missing"])));
        const result = await runIsolatedBatch(
          items,
          createPreparationBatchDispatch(ledger, 50, { complete }, documentFacts, {
            ...budget,
            requests: 1,
          }),
          options,
        );
        expect(
          result.results.every((item) => item.error === "budget_exhausted" && item.output === null),
        ).toBe(true);
        expect(complete).toHaveBeenCalledOnce();
        expect((await ledger.snapshot(50)).budget.used).toBe(1);
      });

      it("honors route backoff and never amplifies quota or rate-limit failures", async () => {
        const complete = vi.fn(async () => {
          throw new DomainError("RATE_LIMITED", "Synthetic upstream limit.");
        });
        const result = await runIsolatedBatch(
          items,
          createPreparationBatchDispatch(ledger, 50, { complete }, documentFacts, budget),
          options,
        );
        expect(result.results.every((item) => item.error === "route_unavailable")).toBe(true);
        expect(complete).toHaveBeenCalledOnce();
        expect((await ledger.snapshot(50)).route.status).toBe("rate_limited");
        expect((await ledger.snapshot(50)).budget.used).toBe(1);
      });

      it("rejects stale facts and reviewed-purpose expansion before reserving or sending", async () => {
        const complete = vi.fn();
        const input = structuredClone(items);
        if (!input[0]?.node.input.facts[0]) throw new Error("Missing fixture.");
        input[0].node.input.facts[0].revision = 99;
        const dispatch = createPreparationBatchDispatch(
          ledger,
          50,
          { complete },
          documentFacts,
          budget,
        );
        await expect(dispatch(input, new AbortController().signal)).rejects.toMatchObject({
          code: "CLAIM_UNSUPPORTED",
        });
        const reviewed = createPreparationBatchDispatch(
          ledger,
          50,
          { complete },
          documentFacts,
          budget,
          "reviewed-career-facts-v1",
        );
        await expect(
          reviewed(
            items.map((item) => ({ ...item, node: { ...item.node, kind: "form_answer_planner" } })),
            new AbortController().signal,
          ),
        ).rejects.toMatchObject({ code: "MODEL_ROUTE_INELIGIBLE" });
        expect(complete).not.toHaveBeenCalled();
        expect((await ledger.snapshot(50)).budget.used).toBe(0);
      });

      it("charges token overrun and rejects aborted work without reservations", async () => {
        const complete = vi.fn(async () => response(valid(), 8001));
        const dispatch = createPreparationBatchDispatch(
          ledger,
          50,
          { complete },
          documentFacts,
          budget,
        );
        const result = await runIsolatedBatch(items, dispatch, options);
        expect(result.results.every((item) => item.error === "budget_exhausted")).toBe(true);
        expect((await ledger.snapshot(50)).budget.used).toBe(1);
        const controller = new AbortController();
        controller.abort();
        await expect(dispatch(items, controller.signal)).rejects.toThrow();
        await expect(dispatch(items, new AbortController().signal)).rejects.toMatchObject({
          code: "MODEL_QUOTA_EXHAUSTED",
        });
        expect(complete).toHaveBeenCalledOnce();
        expect((await ledger.snapshot(50)).budget.used).toBe(1);
      });
    },
  );
