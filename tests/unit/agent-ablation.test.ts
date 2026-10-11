import { expect, it } from "vitest";
import { buildRequest } from "../../packages/inference/src/gateway.js";
import {
  boundCompletionTokens,
  completionContextBound,
} from "../../packages/inference/src/transport.js";
import { evaluateP12Ablation } from "../../scripts/evaluate-p12.js";
import { matchingEvaluationCases } from "../fixtures/matching-evaluation.js";

it("compares all holdout routes and eligible packet variants without enabling unproven graphs", async () => {
  const report = await evaluateP12Ablation();
  expect(report.holdoutJobs).toBe(12);
  expect(report.packetEligibleJobs).toBe(3);
  expect(report.routingErrors).toBe(0);
  expect(report.productionGraphEnabled).toBe(false);
  expect(report.evidenceKind).toBe("synthetic_transport_not_live_model");
  expect(report.variants.map((variant) => variant.requestsPerAcceptedPacket)).toEqual([0, 1, 2]);
  expect(
    report.variants.every(
      (variant) =>
        variant.claimErrors === 0 && variant.acceptedPackets === 3 && variant.correctionRate === 0,
    ),
  ).toBe(true);
});

it("admits only a bounded output allowance after conservative input accounting", () => {
  const fixture = matchingEvaluationCases[0];
  if (!fixture) throw new Error("Missing synthetic fixture.");
  const request = buildRequest(fixture.input, "synthetic/model:free", "synthetic-provider");
  const prompt = completionContextBound(request);
  expect(boundCompletionTokens(request, prompt + 100).max_tokens).toBe(100);
  expect(() => boundCompletionTokens(request, prompt)).toThrow("Prompt cannot fit");
  expect(() => boundCompletionTokens(request, 0)).toThrow("Invalid declared");
});
