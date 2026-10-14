import assert from "node:assert/strict";
import type { CandidateFact } from "../../packages/contracts/src/candidate.js";
import type { DocumentClaim } from "../../packages/contracts/src/documents.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { validatePacketContent } from "../../packages/documents/src/validation.js";
import type { RegressionCorrection } from "../../packages/security/src/regression-fixture.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

type Variant = Extract<RegressionCorrection, { kind: "fact_correction" }>["variant"];

export function factCorrectionCase(variant: Variant) {
  const input = structuredClone(documentGenerationInput());
  input.requestedAnswers = input.requestedAnswers.filter(
    (answer) => answer.semanticKey === "right_to_work",
  );
  let before: CandidateFact;
  if (variant === "metric_value") {
    const base = input.profile.facts[0];
    assert(base);
    before = {
      ...base,
      id: "fact-synthetic-metric",
      key: "synthetic-metric",
      value: {
        kind: "metric",
        statement: "Measured throughput",
        value: 120,
        unit: "messages",
        context: "Synthetic queue",
      },
    };
    input.profile.facts.push(before);
  } else {
    const fact = input.profile.facts.find(
      (item) =>
        item.id === (variant === "employment_period" ? "fact-employment-full" : "fact-language"),
    );
    assert(fact);
    before = fact;
  }
  const after = structuredClone(before);
  after.revision++;
  if (after.value.kind === "employment") after.value.end = "2023-12";
  else if (after.value.kind === "language") after.value.level = "B2";
  else if (after.value.kind === "metric") after.value.value = 80;
  const correctedInput = structuredClone(input);
  correctedInput.profile.id = "profile-synthetic-corrected";
  correctedInput.profile.revision++;
  correctedInput.assessment.profileId = correctedInput.profile.id;
  correctedInput.authorization.profileVersionId = correctedInput.profile.id;
  correctedInput.profile.facts = correctedInput.profile.facts.map((fact) =>
    fact.id === before.id ? after : fact,
  );
  const originalContent = generatePacketContent(input);
  const correctedContent = generatePacketContent(correctedInput);
  const metricClaim = (fact: CandidateFact): DocumentClaim => {
    assert(fact.value.kind === "metric");
    return {
      id: `metric:synthetic-${fact.revision}`,
      kind: "metric",
      text: `${fact.value.statement}: ${fact.value.value} ${fact.value.unit} (${fact.value.context}).`,
      evidence: [{ factId: fact.id, revision: fact.revision }],
      origin: "deterministic",
      deliveryStatus: null,
    };
  };
  if (variant === "metric_value") {
    originalContent.letter.contributions.push(metricClaim(before));
    correctedContent.letter.contributions.push(metricClaim(after));
  }
  return { input, correctedInput, originalContent, correctedContent, before, after };
}

export function verifyFactCorrection(variant: Variant) {
  const fixture = factCorrectionCase(variant);
  const validate = (content: typeof fixture.originalContent) =>
    validatePacketContent({
      content,
      profile: fixture.correctedInput.profile,
      assessment: fixture.correctedInput.assessment,
      asOf: fixture.correctedInput.asOf,
      checkedAt: fixture.correctedInput.generatedAt,
    });
  const stale = validate(fixture.originalContent);
  assert.equal(stale.status, "blocked");
  assert(stale.issues.some((issue) => issue.code === "CLAIM_UNSUPPORTED"));
  assert.equal(validate(fixture.correctedContent).status, "valid");
}
