# P16 Fixed Horizon Cohorts

2026-10-11. P16-02/G3 remain in progress. This completes the immutable cohort
capture/report/compare workflow, not every grouping signal or cumulative
conversion analysis. No live corpus was inspected and no empirical outcome
improvement is claimed.

## Capture And Evidence

Authenticated `POST /v1/outcomes/cohorts` accepts a UUID, completed receipt UTC
`from`/`through` window, observation days (1-365, default 30), and minimum sample
(20-1,000, default 20). The server supplies the knowledge cutoff `asOf` under its
owner lock; caller timestamps, members, outcomes and grouping labels are refused.
An additive migration persists the minimized, hash-checked immutable snapshot in
the authoritative database, with an owner audit/outbox event. There is no update
or delete route. Exact identity retries replay the same snapshot even after source
changes; changed reuse fails. Reads verify both digest and snapshot ID.

Only non-synthetic, currently CONFIRMED applications with an attributed confirmed
attempt/intent and a typed, digest-verified non-mock receipt qualify. Receipt job
attribution, chronology, and Gmail application/attempt attribution are checked.
Malformed, missing, hash-changed or mock receipts cannot establish a live member.
The earliest known confirmed receipt is selected; invalid evidence is not skipped
in search of a later favorable receipt. Synthetic, unverified, unresolved,
out-of-window, still-observing and duplicate records are counted separately.
Canonical job identity is resolved and counted once at capture time; cycles or
excessive depth fail. Later identity revisions do not rewrite frozen membership.

The observation horizon is the receipt's **observed-at timestamp plus the declared
days**, not an inferred employer-submission date. Latest recorded-revision outcome
evidence must occur at or before that member's horizon and be known by capture's
cutoff. Missing evidence stays UNKNOWN; silence never becomes rejection. Events
dated after the horizon, including later owner reversals, do not retroactively
alter that horizon's label. Snapshot members retain application/canonical job,
receipt ID/hash, horizon, outcome event/hash and minimized grouping metadata/hash,
not candidate facts, recruiter messages or receipt URLs.

Capture bounds: 10,000 applications/listings/identity edges and 100,000 receipts/
outcome events. Overflow fails atomically rather than truncating. Authenticated
`GET /v1/outcomes/cohorts` provides a digest-verified catalog capped at 1,000
snapshots; `GET /v1/outcomes/cohorts/:id` returns the fixed report, not member data.
Future larger-corpus pagination is not implemented.

## Grouping And Comparisons

Source comes from the stored attributed job. Role family comes from validated
normalized discovery listings for the same canonical job; absent or conflicting
values are UNKNOWN. Metadata is captured now, not falsely reconstructed as the
job's submission-time state. Seniority and sponsorship are explicitly UNKNOWN:
the existing normalized schema has no authoritative structured fields for them.
Document template groups use an attributed, digest-checked packet's CV/letter
templates and generation method, otherwise UNKNOWN. They are not wording/order
experiment variants or immutable model-build identities.

Overall and per-group reports include counts and denominators. Fractions require
at least the declared minimum **in each group**, not only the overall corpus.
Reports state the receipt window, cutoff, observation period and exclusions.
These are current recorded outcome fractions at a fixed horizon, not cumulative
conversion, hiring probabilities, significance or causal effects. Exclusion counts
refer to the entire owner capture before grouping, including in comparison sides;
they are not falsely estimated per-source exclusions.

Authenticated `POST /v1/outcomes/cohorts/compare` accepts left/right snapshot IDs,
one dimension and distinct group values. Both snapshots must have exactly the same
receipt window, cutoff, observation days, minimum and methodology. Missing groups,
same-valued groups and overlapping canonical jobs are refused. Below-threshold
groups return counts with null differences. Eligible comparisons return each
side's numerators/denominators and descriptive left-minus-right fraction differences.
The UI compares disjoint groups within one selected immutable snapshot; it never
silently pools different snapshots. No report changes matching weights, standing
authorization, tasks, application state or submission authority.

## Owner Workflow

Outcomes provides freeze, safe retry, new-snapshot reset, saved-cohort browsing,
group selection and descriptive comparisons. Calendar dates are inclusive UTC
days; default through-date is yesterday to avoid a future end-of-day cutoff.
An ambiguous write response retains the UUID for exact retry. Changing window
inputs or explicitly starting a new snapshot resets it. Old advisory current-state
cohort reports remain a separate, non-fixed workflow.

## Verification

Frozen runtime `pnpm check`: **683 passed / 236 skipped in 91 test files**;
lint, types, ledger and production build pass. Full desktop/mobile Playwright:
**66/66 passed (4.1 minutes)**. Extracted production-only Windows installation:
**1/1 passed (26.76 seconds total test run)**. Inspected screenshots and page
overflow assertions pass. Public-source scan passes. Successor CI is pending at
publication; PostgreSQL parity cases were skipped locally.

Focused integration/unit checks cover fixed replay after source/evidence changes,
late horizon exclusion, typed/malformed/mock receipts, canonical duplicates,
UNKNOWN silence, maturity/minimum refusals, attribution/digest failure, request
spoofing, owner isolation, incompatible windows and overlapping comparison jobs.
They also verify unchanged control and single audit publication. Browser coverage
executes actual synthetic freeze/retry/reload and disabled comparison on no live
members. Measured-group arithmetic is fixture-tested, not a genuine measured
browser corpus or proof of full metadata coverage. Existing browser submission,
changed-form refusal and response-loss reconciliation regressions pass.

Test-only non-synthetic flags and typed synthetic receipts exercise arithmetic;
they are never counted as real employer evidence. No private service/document,
Gmail/model call, employer-facing action or real-duration soak was touched.

## Remaining Scope

P16-02 still needs authoritative seniority/sponsorship signals, real document
variant attribution, submission-time metadata history where required, and a final
honest calibration report. G3 stays in progress because this is not cumulative
conversion reporting. Controlled pre-dispatch experiments, private correction
proposal capture, broader regression cases and scoring-code compatibility remain.
P15 dependencies and genuine live/24-hour/72-hour acceptance remain open.
