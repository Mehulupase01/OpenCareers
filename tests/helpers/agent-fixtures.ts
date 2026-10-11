import type { GraphRunBudget, NodeInput } from "../../packages/contracts/src/agents.js";
import { graphDigest } from "../../packages/persistence/src/graph-repository.js";
export const agentNode: NodeInput = {
  kind: "extractor",
  input: {
    jobId: "synthetic-job",
    description: "Build Python services.",
    facts: [{ id: "fact-python", revision: 1, text: "Built Python services." }],
    claims: [],
    requirements: [],
  },
};
export const agentOutput = {
  kind: "extractor" as const,
  requirements: [{ text: "Python", start: 6, end: 12 }],
};
export const agentBudget: GraphRunBudget = {
  steps: 6,
  wallTimeMs: 30000,
  tokens: 8000,
  requests: 6,
  nodeTokens: 4000,
  nodeRequests: 1,
};
export const agentBinding = (nodes = [agentNode]) => ({
  graphVersion: "graph-v1",
  promptVersion: "prompt-v1",
  schemaVersion: "schema-v1",
  profileVersion: "profile-v1",
  policyRevision: "policy-v1",
  inputSha256: graphDigest(nodes),
});
