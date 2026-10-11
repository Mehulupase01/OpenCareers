import { describe, expect, it } from "vitest";
import { mailClassificationSchema } from "../../packages/contracts/src/email.js";
import { classifyCorrelatedOutcome } from "../../packages/matching/src/outcome-classification.js";

describe("evidence-only outcome classification", () => {
  it("maps only supported correlated application evidence", () => {
    const expected: Record<string, string> = {
      application_received: "RECEIVED",
      interview: "INTERVIEW",
      rejection: "REJECTION",
    };
    for (const classification of mailClassificationSchema.options) {
      expect(
        classifyCorrelatedOutcome({
          classification,
          correlation: "correlated",
          contextKind: "application",
        }),
      ).toBe(expected[classification] ?? "UNKNOWN");
      for (const correlation of ["ambiguous", "unrelated"])
        expect(
          classifyCorrelatedOutcome({ classification, correlation, contextKind: "application" }),
        ).toBe("UNKNOWN");
      for (const contextKind of ["account", null])
        expect(
          classifyCorrelatedOutcome({ classification, correlation: "correlated", contextKind }),
        ).toBe("UNKNOWN");
    }
  });
});
