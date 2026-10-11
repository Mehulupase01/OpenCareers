import { usableFact } from "../../candidate/src/domain.js";
import { nodeInputSchema } from "../../contracts/src/agents.js";
import type { CandidateFact } from "../../contracts/src/candidate.js";
import { DomainError } from "../../contracts/src/index.js";
import { careerTextMinimizer, type PrivacyRevision } from "./privacy.js";

export function minimizedPreparationNode(
  rawNode: unknown,
  facts: CandidateFact[],
  revision: PrivacyRevision,
) {
  const node = nodeInputSchema.parse(rawNode);
  if (revision === "reviewed-career-facts-v1" && node.kind === "form_answer_planner")
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Reviewed career policy does not authorize novel form questions.",
    );
  for (const supplied of node.input.facts) {
    const fact = facts.find(
      (item) => item.id === supplied.id && item.revision === supplied.revision,
    );
    if (
      !fact ||
      !usableFact(fact, new Date().toISOString().slice(0, 10)) ||
      ["identity", "work_authorization", "availability"].includes(fact.value.kind) ||
      !JSON.stringify(fact.value).includes(supplied.text)
    )
      throw new DomainError(
        "CLAIM_UNSUPPORTED",
        "Node facts do not match reviewed career evidence.",
      );
  }
  const minimize = careerTextMinimizer(facts);
  const safe = structuredClone(node);
  const identifiers = [
    safe.input.jobId,
    ...safe.input.facts.map((fact) => fact.id),
    ...safe.input.claims.flatMap((claim) => claim.factIds),
  ];
  if (identifiers.some((id) => minimize(id) !== id))
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Preparation identifiers contain private data.",
    );
  safe.input.description = minimize(safe.input.description);
  for (const fact of safe.input.facts) fact.text = minimize(fact.text);
  for (const claim of safe.input.claims) claim.text = minimize(claim.text);
  for (const requirement of safe.input.requirements) requirement.text = minimize(requirement.text);
  return { node, safe };
}
