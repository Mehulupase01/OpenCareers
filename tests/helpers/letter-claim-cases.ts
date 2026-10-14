import type { LetterClaimReason } from "../../packages/contracts/src/index.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

export function letterClaimCase(reason: LetterClaimReason) {
  const input = documentGenerationInput();
  const content = generatePacketContent(input);
  const contribution = content.letter.contributions[0];
  if (!contribution) throw new Error("Missing synthetic contribution.");
  const proposal = {
    opening: content.letter.opening,
    motivation: "The role's focus on Python makes this platform work especially compelling.",
    contributionIds: [contribution.id],
  };
  switch (reason) {
    case "changed_vacancy":
      proposal.opening = "I am applying at the wrong employer.";
      break;
    case "unsupported_motivation":
      proposal.motivation = "I built 100 production systems using Python.";
      break;
    case "invented_quantity":
      proposal.motivation = "The role's focus on Python supports 100 production systems.";
      break;
    case "other_employer":
      proposal.motivation =
        "The role's focus on Python builds on work at Synthetic Systems Nederland B.V.";
      break;
    case "duplicate_contribution":
      proposal.contributionIds.push(contribution.id);
      break;
    case "unapproved_evidence":
      proposal.contributionIds = ["synthetic-unapproved-evidence"];
      break;
  }
  return { input, content, proposal };
}
