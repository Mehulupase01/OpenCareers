# P16 Outcomes, Calibration, and Continuous Improvement

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
This depends on P15's release gates and on P11's mail evidence; the calibration
result itself is externally blocked because it needs real employer responses
over a real observation window.

## Decision Boundaries

- Never infer a rejection from silence. Absence of mail, an elapsed window, or
  an unanswered application is `UNKNOWN` or `no_response`, never a rejection.
  T23's correlated-mail machinery may classify only what it can evidence.
- Never invent a probability. No UI, API, or report may present a match score,
  a fit percentage, or a conversion rate as a chance of interview, offer, or
  hire. A score is a ranking input, not a forecast.
- Never silently change policy. No measured result may alter authorization,
  daily limits, blocked employers, or mode without a new recorded owner policy
  revision. Calibration informs; the owner decides.
- Keep the ledger owner-scoped and auditable. Every outcome carries source,
  evidence reference, and timestamp. Manual corrections are first-class,
  attributed, and reversible, never an in-place overwrite.
- Do not compare incompatible cohorts. A report states its cohort, observation
  window, and denominator, and refuses to compare groups whose windows differ
  or whose members are still inside their observation period.
- Never leak candidate content into Git. Outcome records, recruiter messages,
  and rejection text stay in the private store. Only sanitized, synthetic
  fixtures enter the repository.
- Do not build an experimentation platform. One owner, one cohort assignment
  record, a declared variant set, and a stop condition.
- Never enable a model change on aggregate metrics alone. A quality
  improvement claim needs a fixed labeled set and stated methodology.

## Implementation Order

1. Outcome ledger. New migration adding `application_outcomes`,
   `outcome_events`, and `experiment_assignments` with owner scoping,
   provenance, and uniqueness per application and outcome class. Add
   `packages/persistence/src/outcome-repository.ts` with typed transitions
   that reuse the existing `ApplicationState` machine, and extend
   `packages/contracts/src` with outcome and experiment schemas. Prove
   lifecycle, attribution, and reversal in
   `tests/integration/outcomes.test.ts` on SQLite and PostgreSQL.
2. Outcome classification and mail attribution. New
   `packages/contracts/src/outcome.ts` and the classifier in
   `packages/matching/src` that consumes P11's correlated messages, mapping
   evidence to `RECEIVED`, `SCREENING`, `INTERVIEW`, `REJECTION`, `OFFER`,
   `WITHDRAWN`, and `UNKNOWN` with a required source and never a
   silence-based rejection. Add the routes in `apps/api/src/outcomes.ts` and
   register them in `apps/api/src/server.ts`. Prove in
   `tests/integration/outcome-classification.test.ts` that an unclassified or
   ambiguous message yields `UNKNOWN`, and that a receipt-linked application
   is never relabelled.
3. Cohort reporting. New `packages/matching/src/calibration.ts` producing
   fixed application cohorts by source, role family, seniority, and
   sponsorship signal, each with an explicit observation window, a
   minimum-sample refusal, and a stated denominator. Add read-only routes and
   a non-deceptive Operations view. Prove in
   `tests/unit/calibration.test.ts` and
   `tests/integration/cohorts.test.ts` that a below-threshold cohort returns
   a refusal rather than a rate, and that in-window members are excluded from
   completed-cohort denominators.
4. Score calibration. Compare fit bands against later-reviewed relevance and,
   where volumes permit, against observed outcomes, publishing discrimination
   and rank correlation only. Prove in
   `tests/unit/score-calibration.test.ts` that no output field is named or
   shaped as a probability, and that the report states sample size, cohort
   window, and its own limits.
5. Quality regression loop. New `scripts/` importer that turns corrected
   facts, rejected claims, misclassified forms, and adapter drift into
   sanitized synthetic fixtures under `tests/fixtures/`, with a redaction guard
   refusing candidate content, employer names where unnecessary, and personal
   identifiers. Prove in
   `tests/security/regression-redaction.test.ts` that the guard rejects a
   seeded real-looking payload, and in
   `tests/integration/regression-loop.test.ts` that a corrected fact produces
   a passing synthetic fixture.
6. Controlled experiments. Extend the outcome repository with assignment
   recorded before the packet is dispatched, a single-variant rule per job, a
   declared metric, and a stop condition. Prove in
   `tests/integration/experiments.test.ts` that a second assignment to the
   same job is refused, that an assignment cannot precede its own dispatch
   record, and that a stopped experiment leaves already-sent applications
   untouched.
7. Calibration report. Write `docs/evidence/P16-calibration.md` recording the
   actual measured figures, their denominators, their windows, and the
   questions that remain unanswerable at current volume, with no policy change
   proposed as already adopted.

## Acceptance Mapping

- P16-G1 "Every outcome is linked to an existing application with
  provenance." `tests/integration/outcomes.test.ts` foreign-key and provenance
  assertions, plus the schema in `packages/contracts/src/outcome.ts`.
- P16-G2 "Recent and unresolved applications are not mislabeled as
  rejections." `tests/integration/outcome-classification.test.ts` and the
  in-window exclusion in `tests/integration/cohorts.test.ts`.
- P16-G3 "Reported conversion rates include numerator, denominator, date
  range, and relevant exclusions." `tests/unit/calibration.test.ts` asserting
  every emitted rate carries all four.
- P16-G4 "No UI uses match score as a fabricated selection probability."
  `tests/unit/score-calibration.test.ts` plus a rendering assertion in the
  Operations and Matching views in `apps/web/src`.
- P16-G5 "Experiments cannot create duplicate applications or unsupported
  claims." `tests/integration/experiments.test.ts` alongside the existing
  `CLAIM_UNSUPPORTED` coverage in `tests/unit/letter-draft.test.ts`.
- P16-G6 "Owner corrections become regression tests without leaking personal
  data into Git." `tests/security/regression-redaction.test.ts` and
  `tests/integration/regression-loop.test.ts`.
- P16-G7 "A recommendation to change policy requires a new recorded owner
  policy revision before it affects commits."
  `tests/integration/experiments.test.ts` and
  `tests/integration/outcomes.test.ts`, asserting the commit gate reads the
  standing authorization and not any analytical output.

## External Gates

Calibration is bounded by real employer behaviour. Every meaningful figure
here needs genuine application outcomes observed over a real window with real
employers, and this repository has no live receipt at all, so the outcome
corpus is currently empty and the calibration report will honestly record
insufficient data. P16's mail attribution also depends on P11's OAuth client
and on P08-G6. No rate, ranking quality claim, or interview probability may be
published from synthetic data, and the phase completes with code and honest
refusals rather than fabricated measurement.

## Traceability Gaps Closed

- No `Appx.B` scenario is closed by this phase. Its contribution is to R03 and
  R05, and to keeping T22, T23, and T32 from being misreported later: P11's
  correlated-mail classification feeds the ledger, and T23's distinction
  between account-created and application-received mail is what prevents an
  unverified account email from being counted as an application outcome.
- R03, "Rank Netherlands-compatible roles with explicit reasons", gains an
  empirical check that its score bands correspond to later-reviewed relevance.
- R05, "Generate a tailored CV and optional motivation letter", gains the
  document-variant dimension for cohort comparison.
- R01 and R02 gain an outcome-based duplicate signal that stays advisory until
  an owner policy revision records it.

## Out Of Scope

This phase does not change authorization, ranking weights, daily limits, or
any commit behaviour, does not add adapters, does not send any employer-facing
request, and does not publish a hiring-probability model. It does not build the
P17 release bundle and does not attempt P08-G6. Synthetic outcomes are never
presented as employer outcomes.
