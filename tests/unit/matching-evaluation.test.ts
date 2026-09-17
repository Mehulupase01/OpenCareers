import { describe, expect, it } from "vitest";
import { evaluateMatching } from "../../packages/matching/src/evaluation.js";
import { matchingEvaluationCases } from "../fixtures/matching-evaluation.js";

describe("frozen matching evaluation", () => {
  it("meets the declared development and untouched holdout gates", () => {
    const report = evaluateMatching(matchingEvaluationCases);
    expect(report.sampleSize).toBeGreaterThanOrEqual(50);
    expect(report.holdoutSize).toBeGreaterThanOrEqual(10);
    expect(report.hardDisqualifiers.correctlyRouted).toBe(report.hardDisqualifiers.total);
    expect(report.autoEligible.precision).toBeGreaterThanOrEqual(0.9);
    expect(report.unsupportedClaims).toBe(0);
    expect(report.errors).toBe(0);
    expect(report.holdoutErrors).toBe(0);
    expect(report.cases.every((entry) => entry.score.total >= 0)).toBe(true);
  });
});
