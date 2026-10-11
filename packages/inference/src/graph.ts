import {
  type GraphBinding,
  type GraphRunBudget,
  type NodeInput,
  type NodeKind,
  type NodeOutput,
  nodeInputSchema,
  nodeKindSchema,
  nodeOutputSchema,
} from "../../contracts/src/agents.js";
import { DomainError } from "../../contracts/src/index.js";
import { type GraphRepository, graphDigest } from "../../persistence/src/graph-repository.js";

export function validateNodeOutput(raw: unknown, node: NodeInput): NodeOutput {
  const output = nodeOutputSchema.parse(raw);
  if (output.kind !== node.kind)
    throw new DomainError("CLAIM_UNSUPPORTED", "Graph output changed node identity.");
  const ids = new Set(node.input.facts.map((fact) => fact.id));
  if (ids.size !== node.input.facts.length)
    throw new DomainError("CLAIM_UNSUPPORTED", "Graph input repeats a fact identity.");
  const checkClaim = (claim: { text: string; factIds: string[] }) => {
    if (
      new Set(claim.factIds).size !== claim.factIds.length ||
      claim.factIds.some((id) => !ids.has(id)) ||
      !node.input.facts.some(
        (fact) => claim.factIds.includes(fact.id) && fact.text.includes(claim.text),
      )
    )
      throw new DomainError(
        "CLAIM_UNSUPPORTED",
        "Graph proposal is not an exact evidenced career span.",
      );
  };
  if (output.kind === "extractor") {
    for (const requirement of output.requirements)
      if (node.input.description.slice(requirement.start, requirement.end) !== requirement.text)
        throw new DomainError("CLAIM_UNSUPPORTED", "Graph requirement lacks exact job evidence.");
  } else if (output.kind === "match_analyst") {
    if (
      new Set(output.matches.map((match) => match.requirementIndex)).size !== output.matches.length
    )
      throw new DomainError("CLAIM_UNSUPPORTED", "Graph repeats a requirement match.");
    for (const match of output.matches)
      if (
        match.requirementIndex >= node.input.requirements.length ||
        new Set(match.factIds).size !== match.factIds.length ||
        match.factIds.some((id) => !ids.has(id))
      )
        throw new DomainError("CLAIM_UNSUPPORTED", "Graph match references another input.");
  } else if (output.kind === "critic") {
    if (output.issues.some((issue) => issue.claimIndex >= node.input.claims.length))
      throw new DomainError("CLAIM_UNSUPPORTED", "Graph critique references another draft.");
  } else if (output.kind === "form_answer_planner") {
    for (const proposal of output.proposals) checkClaim(proposal.claim);
  } else {
    for (const claim of output.claims) checkClaim(claim);
  }
  return output;
}

export type PureNodeHandler = (
  node: NodeInput,
  limits: Readonly<{ maxTokens: number; maxRequests: number; signal: AbortSignal }>,
) => Promise<{ output: unknown; tokens: number; requests: number }>;
type GraphStore = Pick<
  GraphRepository,
  "start" | "reserveNode" | "completeNode" | "finish" | "checkpoint" | "cached"
>;

export async function runPreparationGraph(
  store: GraphStore,
  binding: GraphBinding,
  budget: GraphRunBudget,
  inputs: NodeInput[],
  handlers: Partial<Record<NodeKind, PureNodeHandler>>,
) {
  const nodes = inputs.map((input) => nodeInputSchema.parse(input));
  if (
    !nodes.length ||
    nodes.length > 6 ||
    new Set(nodes.map((node) => node.kind)).size !== nodes.length
  )
    throw new DomainError(
      "CONFIG_INVALID",
      "Graph topology must contain unique bounded preparation nodes.",
    );
  let previous = -1;
  for (const node of nodes) {
    const index = nodeKindSchema.options.indexOf(node.kind);
    if (index <= previous || !handlers[node.kind])
      throw new DomainError("CONFIG_INVALID", "Graph topology or handler is unsupported.");
    previous = index;
  }
  if (binding.inputSha256 !== graphDigest(nodes))
    throw new DomainError("CONFIG_INVALID", "Graph binding does not identify these inputs.");
  const runId = await store.start(binding, budget);
  const signal = AbortSignal.timeout(budget.wallTimeMs);
  const outputs: NodeOutput[] = [];
  try {
    for (const node of nodes) {
      if (signal.aborted)
        throw new DomainError("MODEL_QUOTA_EXHAUSTED", "Graph time budget exhausted.");
      const inputHash = graphDigest(node);
      const cached = await store.cached(binding, inputHash, node.kind);
      const slot = await store.reserveNode(runId, node.kind, cached !== null);
      let tokens = 0;
      let requests = 0;
      let raw: unknown = cached;
      if (!cached) {
        const handler = handlers[node.kind];
        if (!handler) throw new DomainError("CONFIG_INVALID", "Missing fixed graph node.");
        const result = await new Promise<Awaited<ReturnType<PureNodeHandler>>>(
          (resolve, reject) => {
            const abort = () =>
              reject(new DomainError("MODEL_QUOTA_EXHAUSTED", "Graph time budget exhausted."));
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) {
              signal.removeEventListener("abort", abort);
              abort();
              return;
            }
            Promise.resolve()
              .then(() => {
                signal.throwIfAborted();
                return handler(structuredClone(node), {
                  maxTokens: slot.tokenCap,
                  maxRequests: slot.requestCap,
                  signal,
                });
              })
              .then(resolve, reject)
              .finally(() => signal.removeEventListener("abort", abort));
          },
        );
        raw = result.output;
        tokens = result.tokens;
        requests = result.requests;
      }
      const output = validateNodeOutput(raw, node);
      if (signal.aborted)
        throw new DomainError("MODEL_QUOTA_EXHAUSTED", "Graph time budget exhausted.");
      await store.completeNode(runId, slot.ordinal, output, { tokens, requests });
      if (!cached) await store.checkpoint(binding, inputHash, output);
      outputs.push(output);
    }
    await store.finish(runId, "completed");
    return { runId, outputs };
  } catch (error) {
    await store.finish(runId, "failed");
    throw error;
  }
}
