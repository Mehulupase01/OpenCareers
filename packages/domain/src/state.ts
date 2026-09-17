import { type ApplicationState, DomainError } from "../../contracts/src/index.js";

const transitions: Partial<Record<ApplicationState, ApplicationState[]>> = {
  DISCOVERED: ["NORMALIZED"],
  NORMALIZED: ["ASSESSED"],
  ASSESSED: ["ELIGIBLE", "SKIPPED"],
  ELIGIBLE: ["PREPARING"],
  PREPARING: ["PREPARED"],
  PREPARED: ["INSPECTING"],
  INSPECTING: ["READY"],
  READY: ["INTENT_RECORDED"],
  INTENT_RECORDED: ["IN_FLIGHT", "READY"],
  IN_FLIGHT: ["CONFIRMED", "DEFINITIVE_FAILURE", "UNKNOWN"],
  UNKNOWN: ["RECONCILING"],
  RECONCILING: ["CONFIRMED", "NEEDS_REVIEW"],
  NEEDS_REVIEW: ["RECONCILING"],
  DEFINITIVE_FAILURE: ["INSPECTING"],
  NEEDS_INPUT: ["ASSESSED", "INSPECTING"],
  CHALLENGE_REQUIRED: ["INSPECTING"],
  RETRY_WAIT: ["NORMALIZED", "PREPARING", "INSPECTING"],
  PAUSED: ["ASSESSED", "INSPECTING"],
};
const precommit = new Set<ApplicationState>([
  "DISCOVERED",
  "NORMALIZED",
  "ASSESSED",
  "ELIGIBLE",
  "PREPARING",
  "PREPARED",
  "INSPECTING",
  "READY",
  "INTENT_RECORDED",
]);
const exceptions: ApplicationState[] = [
  "SKIPPED",
  "CLOSED",
  "DUPLICATE",
  "NEEDS_INPUT",
  "CHALLENGE_REQUIRED",
  "UNSUPPORTED",
  "PAUSED",
  "RETRY_WAIT",
];

export function assertTransition(from: ApplicationState, to: ApplicationState): void {
  if (transitions[from]?.includes(to) || (precommit.has(from) && exceptions.includes(to))) return;
  throw new DomainError("STATE_INVALID", `Transition ${from} -> ${to} is not permitted.`);
}

export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(300000, 1000 * 2 ** Math.min(18, Math.max(0, attempt - 1)));
  return Math.round(base * (0.75 + Math.min(1, Math.max(0, random())) * 0.5));
}

export function localDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function localDayStart(instant: Date): Date {
  const [year, month, day] = localDay(instant).split("-").map(Number);
  const target = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const offsetAt = (value: number) => {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(value))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    return (
      Date.UTC(
        parts.year ?? 0,
        (parts.month ?? 1) - 1,
        parts.day ?? 1,
        parts.hour ?? 0,
        parts.minute ?? 0,
        parts.second ?? 0,
      ) - value
    );
  };
  let start = target - offsetAt(target);
  start = target - offsetAt(start);
  return new Date(start);
}
