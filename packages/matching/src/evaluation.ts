import type { MatchingInput, MatchScore } from "../../contracts/src/matching.js";
import { fixtureProposal } from "../../inference/src/gateway.js";
import { deterministicGates, outcome, scoreMatch, validateProposal } from "./domain.js";

export type EvaluationLabel = "auto_eligible" | "ineligible" | "review";
export interface EvaluationCase {
  id: string;
  split: "development" | "holdout";
  hardDisqualifier: boolean;
  expected: EvaluationLabel;
  input: MatchingInput;
}

export interface EvaluationCaseResult {
  id: string;
  split: "development" | "holdout";
  expected: EvaluationLabel;
  actual: EvaluationLabel;
  hardDisqualifier: boolean;
  unsupportedClaims: number;
  score: MatchScore;
}

export interface EvaluationReport {
  sampleSize: number;
  holdoutSize: number;
  autoEligible: { truePositive: number; falsePositive: number; precision: number };
  hardDisqualifiers: { total: number; correctlyRouted: number };
  unsupportedClaims: number;
  errors: number;
  holdoutErrors: number;
  cases: EvaluationCaseResult[];
}

export function evaluateMatching(cases: EvaluationCase[]): EvaluationReport {
  const results = cases.map((entry): EvaluationCaseResult => {
    const gates = deterministicGates(entry.input, "2026-09-16");
    const deterministic = gates.some((gate) => gate.status === "fail")
      ? "ineligible"
      : gates.some((gate) => gate.status === "review" && gate.code !== "role")
        ? "review"
        : null;
    let actual: EvaluationLabel;
    let score: MatchScore;
    let unsupportedClaims = 0;
    if (deterministic) {
      actual = deterministic;
      score = scoreMatch(gates, [], 1);
    } else {
      const proposal = fixtureProposal(entry.input);
      try {
        const validated = validateProposal(
          proposal,
          entry.input.job.description,
          entry.input.facts,
        );
        score = scoreMatch(gates, validated.requirements, validated.uncertainty);
        actual = outcome(gates, validated.requirements, score, validated.uncertainty);
      } catch {
        unsupportedClaims += 1;
        score = scoreMatch(gates, [], 1);
        actual = "review";
      }
    }
    return {
      id: entry.id,
      split: entry.split,
      expected: entry.expected,
      actual,
      hardDisqualifier: entry.hardDisqualifier,
      unsupportedClaims,
      score,
    };
  });
  const predictedAuto = results.filter((entry) => entry.actual === "auto_eligible");
  const truePositive = predictedAuto.filter((entry) => entry.expected === "auto_eligible").length;
  const falsePositive = predictedAuto.length - truePositive;
  const hard = results.filter((entry) => entry.hardDisqualifier);
  return {
    sampleSize: results.length,
    holdoutSize: results.filter((entry) => entry.split === "holdout").length,
    autoEligible: {
      truePositive,
      falsePositive,
      precision: predictedAuto.length ? truePositive / predictedAuto.length : 0,
    },
    hardDisqualifiers: {
      total: hard.length,
      correctlyRouted: hard.filter((entry) => entry.actual !== "auto_eligible").length,
    },
    unsupportedClaims: results.reduce((sum, entry) => sum + entry.unsupportedClaims, 0),
    errors: results.filter((entry) => entry.actual !== entry.expected).length,
    holdoutErrors: results.filter(
      (entry) => entry.split === "holdout" && entry.actual !== entry.expected,
    ).length,
    cases: results,
  };
}
