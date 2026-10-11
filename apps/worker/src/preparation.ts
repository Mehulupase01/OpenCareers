import type { Config } from "../../../packages/config/src/index.js";
import { DomainError } from "../../../packages/contracts/src/index.js";
import {
  generatePacketContent,
  type PacketGenerationInput,
} from "../../../packages/documents/src/domain.js";
import type { LetterDraftRunner } from "../../../packages/documents/src/letter-gateway.js";

export async function draftWorkerLetter(
  config: Config,
  input: PacketGenerationInput,
  runner: Pick<LetterDraftRunner, "draft" | "draftWithCritique"> | null,
) {
  if (config.profile === "demo") return undefined;
  if (!runner)
    throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Mandatory LLM letter route is unavailable.");
  const content = generatePacketContent(input);
  return config.inference.letterReviewEnabled
    ? runner.draftWithCritique(input, content, { requests: 3, tokens: 8000, wallTimeMs: 120000 })
    : runner.draft(input, content);
}
