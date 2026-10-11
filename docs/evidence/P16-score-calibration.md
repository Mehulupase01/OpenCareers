# Fixed Reviewed-Relevance Calibration

Verified locally on 2026-10-11. Independent P16 engineering, not completed P16
or a claim about observed employer outcomes.

## Fixed Owner Dataset

Authenticated `POST /v1/outcomes/calibration/datasets` records a completed UTC
review window and owner labels. The strict contract accepts dataset UUID,
`from`, `through`, and 1-1,000 labels containing assessment ID, binary relevance,
reviewed-at time, bounded evidence reference and SHA-256. It does not accept
scores, synthetic flags, model identity, free-text reviews or recruiter messages.

The repository loads same-owner assessments, checks stored digests and job/profile
attribution, and derives scores/synthetic status from storage. Reviews must follow
assessment creation and fall inside the window. Duplicate canonical jobs,
repeated labels and mixed model/provider routes fail atomically. The route digest
identifies a declared route, not an immutable provider build or scoring-code version.

The minimized corpus freezes assessment digests, canonical jobs, scores, review
provenance, route digest and recording time. Later source edits cannot rewrite it.
Exact retries, including reordered labels, are idempotent; changed identity reuse
fails. Reads and retries verify snapshot integrity. Authenticated
`GET /v1/outcomes/calibration/datasets/:id` returns diagnostics. There is no
update/delete route. Writes are owner-audited in the authoritative database;
controls and authorization remain unchanged.

## Diagnostics And Refusals

Only non-synthetic members contribute. Below 20 members, a single relevance
class, or constant scores produce an explicit refusal and null metrics/bands.
Output states dataset, route, sample size, class counts, review window, recording
time and synthetic exclusions. Measured output includes average-tied-rank
Spearman correlation, binary reviewed-relevance discrimination AUC using average
rank sums (half credit for tied pairs), and raw relevance/member counts for fixed
score bands [0,40), [40,70), [70,101).

These are **ranking diagnostics against subjective owner labels**, not likelihoods
of interview, offer or hire. They do not automatically tune weights, choose
models, adopt policy or start submissions. Reports explicitly state subjective
label and out-of-sample limits. No genuine labeled corpus was inspected or
created; no empirical quality improvement is claimed. Mixed routes are not pooled.

## Verification

Final frozen-code `pnpm check`: **672 passed / 232 skipped in 88 files**, with
lint, types, ledger and build passing. Rebuilt extracted production-only Windows
installation passes **1/1 (23.13 seconds)** with the new migration/routes and
existing compiled guarded workflow. Successor CI is pending at publication.

Subsequent CI 38167896062 at ecd45c17d923488a0c036ad4c5dbe9a639977256
passes Windows, Ubuntu and PostgreSQL, including full browser regressions and
extracted production-only Windows installation. This verifies fixed dataset
parity, not the successor regression importer, live labels or P16 completion.

Unit tests cover sample/synthetic refusal, degenerate labels/scores, perfect and
reversed tied rankings, band totals and an independent pairwise tie-aware AUC
oracle. Integration tests cover owner isolation, stored score derivation, refusal
of client scores, assessment/snapshot tampering, review timing, duplicate jobs,
mixed routes, atomic refusal, fixed-corpus replay, audit and unchanged policy.
API tests verify authentication and same-owner not-found behavior. PostgreSQL
cases were skipped locally and require remote parity evidence.

All corpus fixtures are isolated/synthetic, including test-only live flags for
arithmetic checks. Test numbers are not genuine ranking-quality measurements.
No private service, real Gmail/model call, application or long soak was touched.

## Remaining Scope

P16-03 remains in progress: calibration workspace/import, scoring-version cohort
compatibility, outcome-linked evaluation where evidence permits, and final
calibration report remain. P16 also needs grouped fixed outcome cohorts/comparison
refusal, controlled experiments and sanitized correction-driven regressions.
Its P15 dependency remains open. No calibration gate closes from this increment.
