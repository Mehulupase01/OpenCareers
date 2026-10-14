import type { VacancySignals } from "../../contracts/src/cohort.js";

// Match only a small English vocabulary; unsupported wording is not a negative signal.
const seniorityMarkers =
  /\b(internship|intern|junior|jr\.?|mid(?:-level| level)?|senior|sr\.?|lead)\b/gi;
const titleQualifiers =
  /\b(no|not|non|never|neither|nor|without|except|excluding|or|and|to|through|between|assistant|assisting|former|preferably|potential|optional|equivalent|acting|deputy|staff|principal|graduate|trainee|entry|manager|director|head|chief|example|sample|template|hypothetical|quoted|false|citizens?|school|care|generation|poisoning)\b|n['\u2019]t|[/&+?"'`]|\d|[\u0080-\uffff]/i;
const sponsorshipTopic =
  /\b(sponsor\w*|visa\w*|work permit\w*|work authori[sz]\w*|right to work)\b/i;
const qualifiers =
  /\b(if|unless|may|might|could|conditions?|conditional\w*|contingent|depending|eligible|eligibility|only|except|however|but|subject to|provided that|case.by.case|not guaranteed|pending|some|certain|sometimes|usually|generally|example\w*|sample\w*|template\w*|hypothetical\w*|quot\w*|incorrect|false)\b|[?"'`\u2018-\u201d]/i;
const contextualReference =
  /\b(other employers?|competitors?|previous\w*|prior|historic\w*|formerly|used to|last year|in the past|old|outdated|say|says|said|according to|reported\w*)\b/i;
const offered =
  /^(?:(?:we|the employer|our company) (?:offer|provide|will offer|will provide) (?:work )?visa sponsorship(?: for this (?:role|position))?|(?:work )?visa sponsorship (?:is )?available(?: for this (?:role|position))?|(?:we|the employer|our company) sponsor (?:work )?visas)$/i;
const refused =
  /^(?:(?:we|the employer|our company) (?:do not|cannot|will not) (?:offer|provide) (?:work )?visa sponsorship(?: for this (?:role|position))?|(?:work )?visa sponsorship (?:is )?(?:not available|unavailable|not offered|not provided)(?: for this (?:role|position))?|no (?:work )?visa sponsorship|(?:we|the employer|our company) (?:do not|cannot|will not) sponsor (?:work )?visas)$/i;

export function classifyVacancySignals(job: {
  title: string;
  description: string;
}): VacancySignals {
  const result: VacancySignals = {
    method: "explicit_vacancy_signals_v1",
    seniority: "unknown",
    sponsorship: "unknown",
    evidence: [],
  };
  // Do not truncate: an unseen suffix could contradict a supported statement.
  if (job.title.length > 240 || job.description.length > 100000) return result;

  const markers = [...job.title.matchAll(seniorityMarkers)];
  const marker = markers[0];
  if (
    marker &&
    markers.length === 1 &&
    !titleQualifiers.test(job.title) &&
    !qualifiers.test(job.title) &&
    !contextualReference.test(job.title)
  ) {
    const word = marker[0].toLowerCase().replace(/\.$/, "");
    const before = job.title.slice(0, marker.index).trim();
    const after = job.title.slice(marker.index + marker[0].length).trim();
    // Prefixes describe the vacancy, not people mentioned in the title. Intern/lead
    // may also be a role suffix; exclude the unrelated "lead generation" noun.
    if (
      (before === "" || ((word === "intern" || word === "lead") && after === "")) &&
      !/^['\u2019]/.test(after) &&
      !(word === "mid" && after.startsWith("-"))
    ) {
      result.seniority = word.startsWith("intern")
        ? "intern"
        : word === "jr" || word === "junior"
          ? "junior"
          : word.startsWith("mid")
            ? "mid"
            : word === "sr" || word === "senior"
              ? "senior"
              : "lead";
      result.evidence.push({
        dimension: "seniority",
        field: "title",
        start: marker.index,
        end: marker.index + marker[0].length,
        text: marker[0],
      });
    }
  }

  const evidence: VacancySignals["evidence"] = [];
  let sponsorship: VacancySignals["sponsorship"] = "unknown";
  // A qualification elsewhere can scope an otherwise standalone offer.
  if (
    qualifiers.test(job.title) ||
    qualifiers.test(job.description) ||
    contextualReference.test(job.title) ||
    contextualReference.test(job.description)
  )
    return result;
  for (const field of ["title", "description"] as const) {
    for (const clause of job[field].matchAll(/[^.!?;\r\n]+/g)) {
      if (!sponsorshipTopic.test(clause[0])) {
        if (/\b(no|not|never|neither|nor|cannot|unable|without)\b|n['\u2019]t/i.test(clause[0]))
          return result;
        continue;
      }
      const text = clause[0].trim();
      const value = offered.test(text)
        ? "explicitly_available"
        : refused.test(text)
          ? "explicitly_unavailable"
          : "unknown";
      if (
        value === "unknown" ||
        (sponsorship !== "unknown" && value !== sponsorship) ||
        text.length > 300 ||
        evidence.length === 7
      )
        return result;
      sponsorship = value;
      const start = clause.index + clause[0].indexOf(text);
      evidence.push({ dimension: "sponsorship", field, start, end: start + text.length, text });
    }
  }
  result.sponsorship = sponsorship;
  result.evidence.push(...evidence);
  return result;
}
