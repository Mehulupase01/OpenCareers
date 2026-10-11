import { z } from "zod";
import { type NodeInput, type NodeOutput, nodeInputSchema } from "../../contracts/src/agents.js";
import { DomainError } from "../../contracts/src/index.js";
import { validateNodeOutput } from "./graph.js";

const optionsSchema = z
  .object({
    maxItems: z.number().int().min(1).max(16),
    maxContextBytes: z.number().int().min(1000).max(24000),
    maxCalls: z.number().int().min(1).max(32),
    wallTimeMs: z.number().int().min(1).max(120000),
  })
  .strict();
export interface BatchItem {
  id: string;
  node: NodeInput;
}
export interface BatchResult {
  id: string;
  output: NodeOutput | null;
  error: "context_pressure" | "invalid_output" | "budget_exhausted" | "route_unavailable" | null;
}
export type PureBatchDispatch = (
  items: readonly BatchItem[],
  signal: AbortSignal,
) => Promise<unknown>;
const envelope = z
  .object({
    truncated: z.boolean(),
    results: z
      .array(z.object({ id: z.string().min(1).max(120), output: z.unknown() }).strict())
      .max(16),
  })
  .strict();

export async function runIsolatedBatch(
  rawItems: BatchItem[],
  dispatch: PureBatchDispatch,
  rawOptions: z.infer<typeof optionsSchema>,
): Promise<{ results: BatchResult[]; calls: number }> {
  const options = optionsSchema.parse(rawOptions);
  const items = rawItems.map((item) => ({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9._-]{1,120}$/)
      .parse(item.id),
    node: nodeInputSchema.parse(item.node),
  }));
  if (items.length > 100 || new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error("Batch input IDs must be unique and bounded.");
  const signal = AbortSignal.timeout(options.wallTimeMs);
  const results = new Map<string, BatchResult>();
  let calls = 0;
  let deferred: "budget_exhausted" | "route_unavailable" | null = null;
  const bytes = (group: BatchItem[]) => Buffer.byteLength(JSON.stringify(group));
  const run = async (group: BatchItem[]): Promise<void> => {
    if (!group.length) return;
    if (deferred || signal.aborted || calls >= options.maxCalls) {
      for (const item of group)
        results.set(item.id, { id: item.id, output: null, error: deferred ?? "budget_exhausted" });
      return;
    }
    if (bytes(group) > options.maxContextBytes) {
      if (group.length === 1) {
        const item = group[0];
        if (item) results.set(item.id, { id: item.id, output: null, error: "context_pressure" });
        return;
      }
      const middle = Math.ceil(group.length / 2);
      await run(group.slice(0, middle));
      await run(group.slice(middle));
      return;
    }
    calls++;
    let parsed: z.infer<typeof envelope> | null = null;
    try {
      const raw = await new Promise<unknown>((resolve, reject) => {
        const abort = () => reject(new Error("Batch time budget exhausted."));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          signal.removeEventListener("abort", abort);
          abort();
          return;
        }
        Promise.resolve()
          .then(() =>
            signal.aborted
              ? Promise.reject(new Error("Batch time budget exhausted."))
              : dispatch(structuredClone(group), signal),
          )
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      });
      parsed = envelope.parse(raw);
      if (
        parsed.truncated ||
        parsed.results.length !== group.length ||
        new Set(parsed.results.map((result) => result.id)).size !== group.length ||
        parsed.results.some((result) => !group.some((item) => item.id === result.id))
      )
        parsed = null;
    } catch (error) {
      if (error instanceof DomainError) {
        if (error.code === "MODEL_QUOTA_EXHAUSTED") deferred = "budget_exhausted";
        else if (["MODEL_ROUTE_INELIGIBLE", "RATE_LIMITED"].includes(error.code))
          deferred = "route_unavailable";
      }
      parsed = null;
    }
    if (deferred || signal.aborted) {
      for (const item of group)
        results.set(item.id, { id: item.id, output: null, error: deferred ?? "budget_exhausted" });
      return;
    }
    if (!parsed) {
      if (group.length > 1) {
        const middle = Math.ceil(group.length / 2);
        await run(group.slice(0, middle));
        await run(group.slice(middle));
        return;
      }
      const item = group[0];
      if (item) results.set(item.id, { id: item.id, output: null, error: "invalid_output" });
      return;
    }
    for (const item of group) {
      try {
        const raw = parsed.results.find((result) => result.id === item.id)?.output;
        results.set(item.id, {
          id: item.id,
          output: validateNodeOutput(raw, item.node),
          error: null,
        });
      } catch {
        results.set(item.id, { id: item.id, output: null, error: "invalid_output" });
      }
    }
  };
  let group: BatchItem[] = [];
  for (const item of items) {
    const sizes = [...group, item].map((value) => bytes([value]));
    if (
      group.length &&
      (group.length >= options.maxItems ||
        group[0]?.node.kind !== item.node.kind ||
        Math.max(...sizes) > Math.min(...sizes) * 2 ||
        bytes([...group, item]) > options.maxContextBytes)
    ) {
      await run(group);
      group = [];
    }
    group.push(item);
  }
  await run(group);
  return {
    results: items.map(
      (item) => results.get(item.id) ?? { id: item.id, output: null, error: "budget_exhausted" },
    ),
    calls,
  };
}
