# Amsterdam Daily Budget Accounting

2026-10-11. Inference reservations, task-class allocations, expired unsent
reservation release and the dashboard budget now derive their day window from
immutable UTC creation timestamps. Submission policy counts derive the same
window from attempt start timestamps. The window is half-open, from Amsterdam
midnight to the following Amsterdam midnight, not midnight UTC or 24 elapsed
hours. Owner locking and conservative counting of all submission attempts remain.

`localDayWindow` reuses the existing timezone conversion. One clock instant
binds each inference reservation's quota check, legacy display-day value, UTC
creation and expiry. The legacy `day` column remains for schema compatibility,
but no quota read trusts it. No existing historical timestamp is rewritten;
this change does not require migrating an owner's private database.

The SQLite/PostgreSQL integration matrix checks ordinary rollover, the 2026
23-hour spring day and 25-hour autumn day, no reset at the skipped/repeated
clock hour, durable usage across repository reconstruction, byte-identical old
timestamps, and rejection of extra calls when legacy day metadata is wrong.
Domain tests verify exact window endpoints, including the exclusive next day.

Counter fixtures seed an UNKNOWN historical attempt and non-dispatchable packet
metadata explicitly; they are not final-click, duplicate-reconciliation, receipt
or live throughput evidence. No external employer or model endpoint is contacted.
Focused verification before the final single-instant refinement passed 35 tests,
29 PostgreSQL skipped across four files. Full local/browser/remote results are
recorded in the handoff after their completion.

P13 is still open: startup/reboot/sleep/network, scheduling controls and target
readout, varied capacity workloads, genuine 24-hour soak, and receipt-backed ramp
are not established by this clock test. Server/hybrid and P15 72-hour soak also
remain. No scheduled background coding continuation could be created on this host.
