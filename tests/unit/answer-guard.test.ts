import { describe, expect, it } from "vitest";
import { assertGuardedPlan } from "../../packages/browser/src/answer-guard.js";
import type { FieldPlan, FormSnapshot } from "../../packages/contracts/src/browser.js";
import { DomainError, FormDriftError } from "../../packages/contracts/src/index.js";

const snapshot: FormSnapshot = {
  url: "https://synthetic.example/jobs/1",
  origin: "https://synthetic.example",
  jobId: "synthetic-job",
  step: 1,
  fields: [],
  fingerprint: "a".repeat(64),
  blocker: "none",
};
const plan: FieldPlan = { fingerprint: snapshot.fingerprint, entries: [], unresolved: [] };
describe("canonical answer guard classification", () => {
  it.each(["POLICY_REVOKED", "TASK_CANCELLED"] as const)(
    "keeps %s distinct from adapter form drift",
    async (code) => {
      const failure = new DomainError(code, "Synthetic owner control changed.");
      await expect(
        assertGuardedPlan(
          async () => {
            throw failure;
          },
          snapshot,
          plan,
        ),
      ).rejects.toBe(failure);
    },
  );
  it("still treats changed answer approval as unsupported form preparation", async () => {
    await expect(
      assertGuardedPlan(
        async () => ({ ...plan, unresolved: ["synthetic-question"] }),
        snapshot,
        plan,
      ),
    ).rejects.toBeInstanceOf(FormDriftError);
  });
});
