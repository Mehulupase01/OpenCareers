# Intent-Frozen Vacancy Signals

Engineering milestone, 2026-10-14. Local frozen verification passes; successor CI
is pending. This is analytical metadata, not a matching or immigration decision.

## Authority And Compatibility

The existing guarded intent transaction captures strict metadata v2 from the
same authoritative job row used for its job digest. Source, role family and
synthetic provenance retain their existing capture checks. New seniority and
sponsorship signals use a fixed local classifier and bounded exact title or
description spans. No assessment, candidate-relative sponsorship gate, candidate
experience or later listing supplies these dimensions. No inference call,
database migration, adapter or submission authority is added.

Original v1 metadata retains its exact schema shape, field order and JSON bytes.
Old intents and saved snapshots are never backfilled. Only v2 members receive
the optional classification-method provenance; old members remain unknown and
classification-unavailable. Existing metadata hash branches remain unchanged;
v2 signals are covered by the already-frozen metadata and snapshot digests.

## Conservative Classification

The v1 classifier intentionally recognizes a small English vocabulary, not every
job title, language or employer phrasing. Seniority requires one unqualified
vacancy-title marker: intern, junior, mid, senior or lead. Years of experience
and responsibilities are not substitutes. Multi-level, contextual, negated or
otherwise ambiguous titles remain unknown.

Sponsorship requires an unambiguous supported employer offer or refusal.
Silence, work-authorization requirements, conditional or conflicting wording,
quoted examples and historical/other-employer references remain unknown.
Global contextual refusals deliberately favor false negatives over unsupported
positive labels. This is not a sponsorship guarantee or a measured classifier
accuracy claim. Unsupported input bounds also return unknown without blocking
submission. Accepted evidence is bounded, unique and exact-length; nonunknown
labels require dimension-appropriate evidence. Capture tests check actual spans.

## Reporting

Fixed cohorts materialize only the captured v2 categories. Later job, listing
and assessment edits cannot change them. Unknown members remain in denominators;
observation horizons, minimum samples and synthetic exclusions are unchanged.
Reports expose classified versus legacy-unavailable counts overall and per group.
Seniority/sponsorship comparisons require compatible intent-time classification;
mixed provenance is refused rather than treated as measured absence.

Desktop/mobile selectors use readable signal labels and show provenance counts.
Fractions remain descriptive observations, not causal effects, hiring probabilities
or automatic changes to matching, policy or final-action authorization.

## Verification

- Classifier/contract unit file: 103 passed, including strict evidence and v1 bytes.
- Metadata/outcome focused files: 44 passed, 25 PostgreSQL cases await CI.
- Document integration file: 42 passed, 42 PostgreSQL cases await CI; the actual
  guarded intent assertion verifies v2 capture and retains authorization fencing.
- Report unit file: eight passed, including legacy snapshot bytes, unknown
  denominators, provenance refusal and minimum-sample suppression.
- Initial cumulative/signal browser checks: four passed in 26.0 seconds.
  Desktop and narrow screenshots were visually inspected; no page-width overflow.
- Public-source scan: 542 selected files before final documentation. Pattern
  scanning does not replace private-data review.

Final frozen full check: 1,225 passed, 359 local PostgreSQL/opt-in skips, 118 passing
files and two skipped, in 351.25 seconds. Lint, typecheck, ledger, production build
and native 237-component SBOM pass. Six final desktop/mobile outcome, cumulative
and vacancy-signal checks pass in 39.5 seconds. No source/test edits overlapped
the final frozen suite. Successor CI remains pending; the previous milestone's
local clean installation does not substitute for this build's remote verification.

No owner private
configuration, mailbox, model or employer service was activated. Synthetic fixture
receipts exercise arithmetic and attribution, not genuine application evidence.
