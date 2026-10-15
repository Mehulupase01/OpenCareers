import { LetterClaimError } from "../../contracts/src/index.js";

// Bounded content screening, not general prompt-injection detection or authority.
export const motivationDirectives = [
  /\b(?:ignore|disregard|override|bypass)(?:\s+[a-z'-]+){0,4}\s+(?:instructions?|prompts?|polic(?:y|ies)|rules?|approval|authorization)\b/i,
  /\b(?:you are now|act as)\s+(?:(?:the|a)\s+)?(?:system|assistant|administrator|owner)\b/i,
  /\b(?:reveal|disclose|leak|exfiltrate|send|upload)\b[^.!?;\r\n]{0,80}\b(?:credentials?|secrets?|tokens?|api[_ -]?keys?|owner[_ -]?tokens?|system prompt|private (?:candidate data|files?|data)|owner data)\b/i,
  /\b(?:read|open|execute|run|invoke)\s+(?:(?:the|a)\s+)?(?:file:\/\/|\.env\b|powershell\b|cmd\b|bash\b|shell\b|curl\b|wget\b|private files?\b)/i,
  /\b(?:approve|authorize|confirm|submit)\s+(?:(?:the|this|all|final)\s+){0,3}(?:applications?|submissions?|attempts?|auto[_ -]?submit|owner approval)\b/i,
  /\b(?:set|mark)\s+(?:(?:the|this|all)\s+)?(?:status|applications?|submissions?|attempts?)\s+(?:(?:as|to)\s+)?(?:verified|approved|confirmed|auto[_ -]?submit)\b/i,
  /\b(?:set|disable|enable|change|grant|revoke)\b[^.!?;\r\n]{0,60}\b(?:submissionsPaused|restoreBlocked|stopped|authorization|controls|permissions)\b/i,
];

export function assertLetterMotivation(motivation: string): void {
  const interestOnly = motivation
    .replace(/\bI am (?:drawn|attracted) to\b/gi, " ")
    .replace(/\bI am (?:excited|enthusiastic) about\b/gi, " ")
    .replace(/\bI am interested in\b/gi, " ")
    .replace(/\b(?:interesting|appealing|compelling|exciting) to me\b/gi, " ");
  if (
    motivationDirectives.some((pattern) => pattern.test(motivation)) ||
    /\b(?:I|I've|I'm|I'd|I'll|my|me|mine|we|we've|we're|we'd|we'll|our|ours|the candidate|the applicant)\b/i.test(
      interestOnly,
    ) ||
    /\bus\b/.test(interestOnly)
  )
    throw new LetterClaimError(
      "unsupported_motivation",
      "Letter motivation contains unsupported claims or control prose.",
    );
}
