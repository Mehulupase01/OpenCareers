import type { MailClassification } from "../../contracts/src/email.js";
import type { OutcomeKind } from "../../contracts/src/outcome.js";

export function classifyCorrelatedOutcome(input: {
  classification: MailClassification;
  correlation: string;
  contextKind: string | null;
}): OutcomeKind {
  if (input.correlation !== "correlated" || input.contextKind !== "application") return "UNKNOWN";
  switch (input.classification) {
    case "application_received":
      return "RECEIVED";
    case "interview":
      return "INTERVIEW";
    case "rejection":
      return "REJECTION";
    default:
      return "UNKNOWN";
  }
}
