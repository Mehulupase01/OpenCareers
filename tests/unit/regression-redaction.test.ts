import { describe, expect, it } from "vitest";
import {
  compileRegressionFixture,
  parseRegressionFixture,
  regressionFromFactCorrection,
} from "../../packages/security/src/regression-fixture.js";
import { documentFacts } from "../fixtures/document-packets.js";

describe("categorical regression publication", () => {
  const correction = {
    kind: "workload_correction",
    reviewed: true,
    before: "full_time",
    after: "part_time",
  };
  it("rejects identifiers, private text, URLs, unknown nested data and unreviewed input", () => {
    for (const extra of [
      { candidateName: "Pat Example" },
      { email: "pat.private@example.test" },
      { employer: "Private Employer" },
      { text: "Private recruiter message" },
      { url: "https://private.example.test/applicant" },
      { facts: documentFacts },
      { secret: "synthetic-secret" },
    ])
      expect(() => compileRegressionFixture({ ...correction, ...extra })).toThrow();
    expect(() => compileRegressionFixture({ ...correction, reviewed: false })).toThrow();
    expect(() => compileRegressionFixture({ ...correction, after: "full_time" })).toThrow();
    expect(() => compileRegressionFixture({ kind: "unknown_case", reviewed: true })).toThrow();
  });
  it("extracts only workload categories from a verified private correction", () => {
    const before = documentFacts.find((fact) => fact.id === "fact-employment-full");
    if (before?.value.kind !== "employment") throw new Error("Missing synthetic employment.");
    const after = {
      ...before,
      revision: before.revision + 1,
      value: { ...before.value, workload: "part_time" },
    };
    const proposal = regressionFromFactCorrection(before, after);
    expect(proposal).toEqual(correction);
    const generated = compileRegressionFixture(proposal);
    expect(generated.bytes.toString()).not.toContain(before.value.employer);
    expect(generated.bytes.toString()).not.toContain(before.id);
    expect(generated.bytes.toString()).not.toContain(before.value.start);
    expect(regressionFromFactCorrection(before, { ...after, status: "extracted" })).toBeNull();
    expect(regressionFromFactCorrection(before, { ...after, id: "other" })).toBeNull();
    expect(parseRegressionFixture(JSON.parse(generated.bytes.toString()))).toEqual(
      generated.fixture,
    );
  });
});
