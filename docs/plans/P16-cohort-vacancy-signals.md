# Intent-Frozen Vacancy Signals

Next bounded P16 milestone after approved wording generation verification.
Windows first; no new adapter, inference, eligibility or submission authority.

## Decision

Current cohorts deliberately group seniority and sponsorship as unknown. Capture
conservative, versioned vacancy signals from the same authoritative job row as
the guarded intent, with title/description span evidence and its existing digest.
Do not interpret candidate-relative sponsorship gates as employer sponsorship.
Do not use candidate experience, years requirements or a later assessment to
guess vacancy seniority. Missing, conditional, conflicting or unsupported wording
remains unknown; these are analytical signals, not guarantees or policy decisions.

## Implementation

1. Add a strict metadata v2 alongside unchanged v1. Require bounded exact-span
   evidence, a fixed classification method and categorical seniority/sponsorship.
2. Add a deterministic local classifier accepting only explicit vacancy-level
   title markers and unambiguous employer sponsorship wording. Preserve unknown
   for multi-level titles, negation, conditional wording and conflicting signals.
3. Capture v2 inside the existing intent transaction. No migration or additional
   inference call; malformed attribution/evidence still fails closed.
4. Materialize v2 dimensions and method provenance in fixed cohorts. Legacy v1
   and absent metadata remain unknown without backfill, defaults or byte changes.
5. Keep existing report dimensions/UI, add readable labels/provenance as needed,
   and refuse comparisons mixing incompatible classification provenance.

## Acceptance

- Explicit classes, silence, negation, conditional and conflicting wording,
  span bounds and malformed categories have focused unit coverage.
- Legacy metadata/snapshot bytes, checksums and same-ID replay stay unchanged.
- Joined submission/cohort tests prove later job/listing/assessment changes
  cannot rewrite frozen signals; owner/digest/identity and synthetic isolation
  checks remain effective.
- Unknown groups remain in denominators. Fixed observation windows and minimum
  samples stay unchanged; no hiring probability or measured improvement claim.
- Desktop/mobile views show both dimensions and comparison refusals correctly.
- Frozen full verification, relevant browser checks and successor CI precede
  gate closure. This milestone alone does not close P16 or its P15 dependencies.

Primary integration points: `submission-metadata.ts`, contracts `cohort.ts`,
`cohort-repository.ts`, `cohort-report.ts` and `cohorts.tsx`. The source authority
is `jobInputSchema`; normalized listings currently expose role family only.
