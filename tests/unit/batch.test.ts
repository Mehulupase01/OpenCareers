import { describe, expect, it } from "vitest";
import { type BatchItem, runIsolatedBatch } from "../../packages/inference/src/batch.js";
import { agentNode, agentOutput } from "../helpers/agent-fixtures.js";

const options = { maxItems: 8, maxContextBytes: 24000, maxCalls: 8, wallTimeMs: 1000 };
const items: BatchItem[] = ["alpha", "beta"].map((id) => ({
  id,
  node: { ...agentNode, input: { ...agentNode.input, jobId: `job-${id}` } },
}));
const valid = (group: readonly BatchItem[]) => ({
  truncated: false,
  results: group.map((item) => ({ id: item.id, output: agentOutput })),
});
describe("Independent pure preparation batches", () => {
  it("accepts reordered output with exact item IDs", async () => {
    const result = await runIsolatedBatch(
      items,
      async (group) => ({ ...valid(group), results: valid(group).results.reverse() }),
      options,
    );
    expect(result.calls).toBe(1);
    expect(result.results.map((item) => item.id)).toEqual(["alpha", "beta"]);
    expect(result.results.every((item) => item.error === null)).toBe(true);
  });
  it.each(["truncated", "missing", "duplicate", "unknown"])(
    "splits %s output instead of accepting a short batch",
    async (kind) => {
      const result = await runIsolatedBatch(
        items,
        async (group) => {
          const wire = valid(group);
          if (group.length === 1) return wire;
          if (kind === "truncated") wire.truncated = true;
          if (kind === "missing") wire.results.pop();
          if (kind === "duplicate" && wire.results[1] && wire.results[0])
            wire.results[1].id = wire.results[0].id;
          if (kind === "unknown" && wire.results[1]) wire.results[1].id = "foreign";
          return wire;
        },
        options,
      );
      expect(result.calls).toBe(3);
      expect(result.results.every((item) => item.error === null)).toBe(true);
    },
  );
  it("quarantines contamination to the affected employer", async () => {
    const result = await runIsolatedBatch(
      items,
      async (group) => ({
        truncated: false,
        results: group.map((item) => ({
          id: item.id,
          output:
            item.id === "alpha"
              ? { ...agentOutput, requirements: [{ text: "Another employer", start: 0, end: 16 }] }
              : agentOutput,
        })),
      }),
      options,
    );
    expect(result.results[0]?.error).toBe("invalid_output");
    expect(result.results[1]?.error).toBeNull();
  });
  it("defers oversized items and preserves bounded call accounting", async () => {
    const oversized = structuredClone(items);
    if (oversized[0]) oversized[0].node.input.description = "x".repeat(25000);
    const result = await runIsolatedBatch(oversized, async (group) => valid(group), options);
    expect(result.results[0]?.error).toBe("context_pressure");
    expect(result.results[1]?.error).toBeNull();
    const failed = await runIsolatedBatch(items, async () => ({ truncated: true, results: [] }), {
      ...options,
      maxCalls: 1,
    });
    expect(failed.calls).toBe(1);
    expect(failed.results.every((item) => item.error === "budget_exhausted")).toBe(true);
  });
  it("rejects duplicate input IDs and bounds a stalled transport", async () => {
    await expect(
      runIsolatedBatch(
        [items[0] as BatchItem, items[0] as BatchItem],
        async (group) => valid(group),
        options,
      ),
    ).rejects.toThrow("unique");
    const result = await runIsolatedBatch(items, async () => new Promise(() => {}), {
      ...options,
      wallTimeMs: 20,
    });
    expect(result.results.every((item) => item.error === "budget_exhausted")).toBe(true);
  });
});
