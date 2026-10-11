# Full-Corpus Operations Readout

2026-10-11. The existing owner-authenticated summary now includes all application
state counts, not counts derived from the newest 100 display rows. The dashboard
exposes these in an unframed pipeline disclosure and explicitly labels the
denominator as all tracked applications. Counts are all-time and include tracked
synthetic/historical data; this is not daily live throughput or target attainment.

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

P13-03 is in progress, not complete. Daily target shortfall, distinct live and
synthetic cohorts, quota integration and the complete needs-help/next-eligible
work readout remain. P13-G6 is not closed by this partial readout.
