import { describe, expect, it } from "vitest";
import {
  allocationLimits,
  graphBudgetSchema,
  nodeInputSchema,
  nodeOutputSchema,
} from "../../packages/contracts/src/agents.js";
import { validateNodeOutput } from "../../packages/inference/src/graph.js";
import { agentBudget, agentNode, agentOutput } from "../helpers/agent-fixtures.js";

describe("Preparation-only agent contracts", () => {
  it("keeps the chapter-eight allocation at 50 including eight reserved", () => {
    expect(Object.values(allocationLimits).reduce((sum, value) => sum + value, 0)).toBe(50);
    expect(allocationLimits.unallocated_reserve).toBe(8);
  });
  it.each(["tools", "permit", "attempt", "browserState", "applicationState"])(
    "rejects %s capability fields",
    (key) => {
      expect(() => nodeInputSchema.parse({ ...agentNode, [key]: {} })).toThrow();
      expect(() => nodeOutputSchema.parse({ ...agentOutput, [key]: {} })).toThrow();
    },
  );
  it("requires exact requirement spans and career claims", () => {
    expect(validateNodeOutput(agentOutput, agentNode)).toEqual(agentOutput);
    expect(() =>
      validateNodeOutput(
        { ...agentOutput, requirements: [{ text: "Java", start: 6, end: 12 }] },
        agentNode,
      ),
    ).toThrow("exact job evidence");
    const node = { ...agentNode, kind: "drafter" as const };
    expect(
      validateNodeOutput(
        { kind: "drafter", claims: [{ text: "Built Python services.", factIds: ["fact-python"] }] },
        node,
      ),
    ).toMatchObject({ kind: "drafter" });
    expect(() =>
      validateNodeOutput(
        {
          kind: "drafter",
          claims: [{ text: "Worked at another employer", factIds: ["fact-python"] }],
        },
        node,
      ),
    ).toThrow("exact evidenced");
  });
  it("rejects unbounded budgets and wrong node identities", () => {
    expect(() => graphBudgetSchema.parse({ ...agentBudget, steps: 7 })).toThrow();
    expect(() => graphBudgetSchema.parse({ ...agentBudget, wallTimeMs: Infinity })).toThrow();
    expect(() => validateNodeOutput({ kind: "critic", issues: [] }, agentNode)).toThrow("identity");
  });
});
