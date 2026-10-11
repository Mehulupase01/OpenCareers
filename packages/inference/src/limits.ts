import { DomainError } from "../../contracts/src/index.js";
import type { CompletionRequest } from "./transport.js";

export function completionContextBound(request: CompletionRequest) {
  return (
    Buffer.byteLength(
      JSON.stringify({ messages: request.messages, response_format: request.response_format }),
    ) + 1024
  );
}

export function boundCompletionTokens(
  request: CompletionRequest,
  totalTokens: number,
): CompletionRequest {
  if (!Number.isSafeInteger(totalTokens) || totalTokens < 1 || totalTokens > 32000)
    throw new DomainError("CONFIG_INVALID", "Invalid declared completion token budget.");
  const remaining = totalTokens - completionContextBound(request);
  if (remaining < 1)
    throw new DomainError("MODEL_QUOTA_EXHAUSTED", "Prompt cannot fit the declared token budget.");
  return { ...request, max_tokens: Math.min(request.max_tokens, remaining) };
}
