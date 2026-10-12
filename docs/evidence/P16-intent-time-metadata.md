# Submission-Time Cohort Metadata

2026-10-12. New guarded intents capture source, role family and synthetic
provenance in the same owner-locked transaction as the immutable intent. The
record contains a versioned method, bound job identity and the source job-data
checksum. It contains no new model inference, candidate material or execution
authority. Approved answers, packet checks, authorization, leases and dispatch
fencing are unchanged.

Role family comes only from normalized listings already attached to that job.
Resolved listings retain their original identity binding. Missing or conflicting
families remain unknown; listing inventory is bounded. No seniority or
sponsorship classification is guessed. Broken attribution or excessive inventory
fails the transaction rather than recording misleading history.

Receipt-backed fixed cohorts validate the containing intent digest and its
application/job/packet bindings before accepting frozen metadata. Later valid job
edits cannot rewrite the captured source or family. Intent-time synthetic
provenance cannot be converted into live evidence by editing the current job.
Old intents and already saved cohorts are not rewritten: legacy source/family
groups retain their explicitly documented snapshot-time meaning. Reports count
both provenance kinds, and source/role comparisons refuse mixed provenance.
Metadata checksums cover the frozen record when present; existing legacy hashes
retain their original format. Reports remain advisory and cannot alter matching,
policy, tasks or submission authority.

Final frozen local check: 745 passed / 262 skipped in 101 files; lint, types,
ledger and production build pass. Focused submission/outcome/experiment suite:
60 / 59 skips before final provenance fields; final reporting/metadata/outcome
suite: 19 / 14 skips, types pass. Desktop/mobile outcome and mock-submission
browser suite: 24/24, including guarded final action, permit expiry, drift and
read-only response-loss reconciliation. Fresh production-only extracted Windows
installation: 1/1 in 139.68 seconds. PostgreSQL cases are retained for successor
CI, not claimed locally. Public scan: 465 selected files before evidence updates.

An earlier broad run overlapped the final source edits: stability detection and
mixed module versions failed that run. It is superseded by the frozen full pass,
not counted as successful evidence. Windows CI 38280309801 at 11f7939 passes the
native census and early adapter rejection, but fails monitored resource collection;
its other three lanes pass. The successor retains only fresh synthetic aggregate
traces under test-results/monitored-capacity on failure for diagnosis. Safety
bounds and fail-closed behavior are unchanged; that CI failure is not fixed by
claiming the local pass.

No genuine receipt, production inference or mailbox call occurred. P16 still
needs its remaining signals/variants, broader correction evidence and dependencies.
Counts remain 12/19 phases, 95/128 gates; no additional gate closes.
