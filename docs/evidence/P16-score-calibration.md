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

P16-03 remains in progress: scoring-version cohort compatibility,
outcome-linked evaluation where evidence permits, and final
calibration report remain. P16 also needs grouped fixed outcome cohorts/comparison
refusal, controlled experiments and sanitized correction-driven regressions.
Its P15 dependency remains open. No calibration gate closes from this increment.

## 2026-10-11: Review Workspace And Catalog

The Outcomes workspace now includes bounded JSON review import, explicit owner
confirmation, immutable dataset recording/retry, saved-dataset selection and
read-only diagnostics. Files larger than 120 KiB or outside the strict existing
contract fail locally with generic messages; no arbitrary source content or parser
diagnostics are displayed. The server retains its independent 128 KiB request
ceiling and existing same-owner assessment, timeline and integrity checks. The
1,000-label schema limit does not override either byte limit.

Input contains only the existing dataset UUID/window and labels, for example:

```json
{
  "id": "f3f66779-9566-40e8-bdc7-462f4d937fc6",
  "from": "2026-09-01T00:00:00.000Z",
  "through": "2026-09-30T00:00:00.000Z",
  "labels": [{
    "assessmentId": "stored-assessment-id",
    "relevant": true,
    "reviewedAt": "2026-09-20T00:00:00.000Z",
    "evidenceRef": "owner-review-id",
    "evidenceSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }]
}
```

This is a schema example, not genuine review evidence. Scores, model identity,
synthetic status and candidate/job text cannot be supplied in the file. Persisted
assessment IDs and actual evidence references/digests must exist or be reviewed
before using the private application. Repeating a save retains the same dataset
identity, so an ambiguous response does not create another dataset automatically.

Authenticated `GET /v1/outcomes/calibration/datasets` returns an owner-only catalog
of IDs, review windows, status, eligible review counts and synthetic exclusions.
It verifies snapshot hashes and ID attribution, orders deterministically, and
refuses more than 1,000 datasets rather than silently truncating. It does not
return label evidence or candidate content. Larger catalogs need a future paged
maintenance workflow; no pagination support is claimed here.

The responsive report shows class counts, UTC window, synthetic exclusions,
minimum sample and explicit refusals. Measured reports show rank correlation,
relevance AUC and raw fit-band counts, never a fabricated hiring probability.
Diagnostics cannot change weights, authorization, controls or application state.
Outcome timestamp entry also now preserves milliseconds; its browser test uses
canonical server-time input instead of truncating before a newly created record.

Final runtime checks: **678 passed / 233 skipped in 90 test files**, lint,
typecheck, ledger and production build pass. After the final browser-fixture
isolation change, lint and typecheck were rerun. Full final desktop/mobile
Playwright suite: **66/66 passed (3.9 minutes)**. Extracted production-only
Windows installation: **1/1 passed (26.58 seconds total test run)**. Public scan
passed; successor cross-platform CI remains pending at publication.

Catalog integration tests cover owner isolation, hash/ID tampering, overflow and
unchanged policy, with PostgreSQL parity cases skipped locally. Browser import,
retry and reload run the actual production API handlers/migrations against a
separate in-memory synthetic database through intercepted requests; they do not
modify the browser suite's shared candidate or discovery records. The measured
display branch uses an explicitly presentation-only intercepted fixture. Neither
is genuine live quality evidence. Inspected desktop/mobile screenshots and page
overflow assertions pass.

Initial runs exposed shared-fixture interference and browser timestamp
normalization; those failing iterations are not final acceptance evidence.
No owner services, private document, model/mailbox call, employer action or
long-duration soak was touched. P16-03/G4 stay in progress; totals remain
12/19 phases and 91/128 gates.

Subsequent CI 38170532775 at 2889dbc930de0a0505e05fef946358220a7dc74f
passes Windows, Ubuntu and PostgreSQL, including full browser regressions and
production-only Windows installation. Source review confirms Matching states
deterministic scores rather than hiring probabilities and displays totals /100;
the calibration UI displays reviewed-relevance diagnostics with explicit limits.
Together with the measured-display/refusal browser assertions and diagnostic unit
contracts, this closes P16-G4 only. P16-03 and the phase remain in progress.
Totals now 12/19 phases and 92/128 gates; successor fixed cohorts are not covered
by this prior run.
