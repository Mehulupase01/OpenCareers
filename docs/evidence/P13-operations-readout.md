# Full-Corpus Operations Readout

2026-10-11. The existing owner-authenticated summary now includes all application
state counts, not counts derived from the newest 100 display rows. The dashboard
exposes these in an unframed pipeline disclosure and explicitly labels the
denominator as all tracked applications. These state counts are all-time and
include tracked synthetic/historical data, separately from daily throughput.

The daily table now counts newly tracked jobs, newly created applications,
attempts started, final dispatches started, and applications with their first
correlated confirmation receipt in the Amsterdam half-open UTC day. It separates
live and synthetic job cohorts using the stored job's explicit synthetic flag.
These are tracked-corpus stages, not counts of every vacancy on the internet or
conversion rates between different daily cohorts. Attempt and dispatch dates
are evaluated independently; UNKNOWN attempts never become confirmations.
Additional receipts on later days do not count the same application again.

`AUTOPILOT_DAILY_TARGET` is a display-only integer from 1 to 50, default 50.
Shortfall compares today's receipt-backed confirmations with that target, using
synthetic activity in demo and live activity in private profiles. It does not
grant authority, change standing submission limits, reserve model requests, or
enable external submission. The existing matching snapshot supplies the actual
used/reserved inference budget and its own day label. Budget and summary reads
are consecutive owner-locked transactions, not one atomic combined snapshot.

The confirmation metric requires a CONFIRMED application with an owned receipt
joined to its own CONFIRMED attempt. Multiple receipts cannot inflate it.
CONFIRMED rows missing that relationship are separately visible as missing
confirmation evidence. UNKNOWN, reconciliation, needs-review and historical
states never become receipt-backed confirmations. Existing canonical confirmation
and reconciliation protocols remain the authority; SQL presence is not new
independent verification of employer evidence.

Next queued task is owner-scoped, due work before future work, with due priority
and deterministic tie-breaking. It is a queue observation, not an eligibility,
lease, final-action permission or promise that paused work will run. Summary
reads hold the existing owner lock; no new database or dispatch engine is added.

Focused tests passed 63 / 48 PostgreSQL skipped across repository, documents and
API suites before the final API-shape assertion. The receipt-positive case uses
the existing guarded mock-confirmation path. A new 105-application fixture proves
full-corpus counting, missing evidence, UNKNOWN isolation, tenant separation and
due-priority ordering. Desktop/mobile pipeline interaction and overflow checks
passed. Full local/browser/CI results are recorded in the handoff after completion.

Daily regression tests cover ordinary and 23/25-hour days, both half-open
boundaries, tenant isolation, a 105-application corpus, display-target validation,
lost-response attempts, and duplicate receipts on a later day. Positive receipt
and lost-response checks use the guarded synthetic submission repository. The
browser UNKNOWN readout test injects a summary fixture only, not a real outcome.
All 60 desktop/mobile browser cases passed; screenshots show the daily table
fits mobile. The populated-schema migration fixture now compares legacy rows
directly before/after migration, then checks the modern summary after migration;
serving the modern summary on schema v1 is not a supported runtime path.

Prior readout CI 38135135228 is green on Windows, Ubuntu and PostgreSQL at
`92b5be1037617b0653a918e3c68a5c89835cac73`. Daily-readout CI 38136577373 is
green on Windows, Ubuntu and PostgreSQL at
`419ae73e1cfa6ebbd58b1c1ef713a71bb3ded6bf`, including all 60 browser cases.
P13-03 and P13-G6 are complete for this readout. Next work remains a queued-task observation,
not an eligibility promise. Installation, hardware power/network drills, actual
soaks and live ramp are not satisfied by this dashboard milestone.
