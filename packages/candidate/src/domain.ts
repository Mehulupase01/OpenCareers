import type { Authorization, CandidateFact, FactValue } from "../../contracts/src/candidate.js";

export function factStatus(fact: CandidateFact, day: string): CandidateFact["status"] {
  return (fact.expiresOn && fact.expiresOn < day) ||
    (fact.value.kind === "work_authorization" &&
      fact.value.permitExpiresOn &&
      fact.value.permitExpiresOn < day)
    ? "expired"
    : fact.status;
}

export function usableFact(fact: CandidateFact, day: string): boolean {
  return ["verified", "owner_asserted"].includes(factStatus(fact, day));
}

export function authorizationStatus(policy: Authorization | null, now: Date): string {
  if (!policy) return "Not configured";
  if (policy.revokedAt) return "Revoked";
  if (Date.parse(policy.expiresAt) <= now.getTime()) return "Expired";
  if (Date.parse(policy.effectiveAt) > now.getTime()) return "Scheduled";
  return policy.mode.replaceAll("_", " ");
}

// Conservative public-availability anchors; unlisted technologies remain unclassified.
export const technologyHistory: Record<string, { earliest: string; source: string }> = {
  python: { earliest: "1991-02", source: "https://docs.python.org/3/faq/general.html" },
  react: { earliest: "2013-05", source: "https://react.dev/versions" },
};
const monthIndex = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
function unionMonths(ranges: Array<[number, number]>): number {
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -1;
  for (const [from, to] of ranges) {
    total += Math.max(0, to - Math.max(from, end + 1) + 1);
    end = Math.max(end, to);
  }
  return total;
}
export function chronology(facts: CandidateFact[], asOf: string) {
  const current = monthIndex(asOf.slice(0, 7));
  const all: Array<[number, number]> = [];
  const full: Array<[number, number]> = [];
  const part: Array<[number, number]> = [];
  const issues: Array<{ factId: string; code: string }> = [];
  for (const fact of facts) {
    const v = fact.value;
    if ("start" in v) {
      const start = monthIndex(v.start);
      const end = v.end ? monthIndex(v.end) : current;
      if (end < start || start > current || end > current) {
        issues.push({ factId: fact.id, code: "CHRONOLOGY_INVALID" });
        continue;
      }
      if (v.kind === "employment" && usableFact(fact, asOf)) {
        all.push([start, end]);
        (v.workload === "full_time" ? full : part).push([start, end]);
      }
    }
    if (v.kind === "skill" && v.firstUsed && monthIndex(v.firstUsed) > current)
      issues.push({ factId: fact.id, code: "CHRONOLOGY_INVALID" });
    if (v.kind === "skill" && v.firstUsed) {
      const anchor = technologyHistory[v.name.trim().toLowerCase()];
      if (anchor && v.firstUsed < anchor.earliest)
        issues.push({ factId: fact.id, code: "TECHNOLOGY_DATE_REQUIRES_REVIEW" });
    }
  }
  return {
    totalMonths: unionMonths(all),
    fullTimeMonths: unionMonths(full),
    partTimeMonths: unionMonths(part),
    issues,
  };
}

export function conflictingFacts(facts: CandidateFact[]): string[] {
  const groups = new Map<string, CandidateFact[]>();
  for (const fact of facts) groups.set(fact.key, [...(groups.get(fact.key) ?? []), fact]);
  return [...groups.values()]
    .filter((group) => new Set(group.map((f) => JSON.stringify(f.value))).size > 1)
    .flatMap((group) => group.map((f) => f.id));
}

export function describeFact(value: FactValue): string {
  switch (value.kind) {
    case "identity":
      return `${value.fullName} | ${value.email}`;
    case "employment":
      return `${value.title}, ${value.employer} (${value.start} to ${value.end ?? "present"}; ${value.workload})`;
    case "education":
      return `${value.qualification}, ${value.institution} (${value.start} to ${value.end ?? "present"})`;
    case "skill":
      return value.name;
    case "language":
      return `${value.name}: ${value.level}`;
    case "project":
      return `${value.name}: ${value.description}`;
    case "metric":
      return `${value.statement}: ${value.value} ${value.unit} (${value.context})`;
    case "availability":
      return `Available ${value.earliestDate ?? "unknown"}; notice ${value.noticeDays ?? "unknown"} days`;
    case "work_authorization":
      return `${value.country}: current permission ${value.currentlyAuthorized}; future sponsorship ${value.futureSponsorship}; permit expiry ${value.permitExpiresOn ?? "unknown"}`;
  }
}

export function authorizationText(policy: Authorization): string {
  return [
    `OpenCareers standing authorization ${policy.id}, revision ${policy.revision}`,
    `Candidate: ${policy.candidateId}. Profile: ${policy.profileVersionId}.`,
    `Mode: ${policy.mode}. ${policy.mode === "auto_submit" ? "Routine eligible applications may be submitted, including the final action, without per-application confirmation." : "Final submission is not authorized."}`,
    `Role terms: ${policy.roleTerms.join(", ")}. Countries: ${policy.countries.join(", ")}.`,
    `Blocked employers: ${policy.blockedEmployerIds.join(", ") || "none"}. Daily submission limit: ${policy.dailyLimit}.`,
    `Account creation: ${policy.allowAccountCreation ? "allowed" : "not allowed"}. Optional disclosures: ${policy.allowOptionalDisclosures ? "allowed" : "not allowed"}.`,
    `Sponsorship wording: ${policy.sponsorshipWording ?? "not approved"}.`,
    `Salary: ${policy.salary ? `${policy.salary.minimum}-${policy.salary.maximum} ${policy.salary.currency} per ${policy.salary.period}` : "no numeric answer approved"}. Negotiable: ${policy.salaryNegotiable ?? "unknown"}.`,
    `Effective: ${policy.effectiveAt}. Expires: ${policy.expiresAt}. Revoked: ${policy.revokedAt ?? "no"}.`,
    "Unknown material answers, stale evidence and unsupported forms remain blocked. Revocation prevents new commits; it cannot recall requests already sent.",
  ].join("\n");
}
