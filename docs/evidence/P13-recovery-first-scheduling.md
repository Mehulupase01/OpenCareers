# Recovery-First Worker Scheduling

2026-10-15. P13 scheduling/P15 recovery engineering, not a completed crash matrix.

## Changed Runtime

The actual worker previously awaited up to five assessments before claiming any
reconciliation task. Slow inference could delay recovery of an accepted but
unacknowledged application. The worker now first asks the existing durable queue
for reconciliation, also recovering expired leases under the owner lock.
Claimed recovery bypasses model work for that iteration. Otherwise one assessment
is processed before ordinary claiming, rather than a five-job batch.

The shared selector is called by the production worker; it executes no task and
grants no authority. Existing owner, stop, lease, domain/concurrency and dispatch
guards apply. A private network-disabled runtime retains preparation-only work
when its letter route is ready; it gains no browser/submission/reconciliation
traffic. Demo remains mock-only. One database and final-action engine remain.

This is priority and finite per-loop assessment bounding, not zero reconciliation
latency or starvation freedom under unlimited load. Already-running model/browser
actions are not preempted. Discovery retains its resumable polling path.

## Joined Synthetic Evidence

The actual owned Chromium/MockATS guarded fixture accepts one application and
loses its response. A fixture callback interrupts the workflow, leaving a real
leased submit task and IN_FLIGHT attempt. An injected clock advances just past
that persisted lease deadline; this is not a physical kill or elapsed outage.

The production selector's actual Repository claim cancels the expired submit,
retains UNKNOWN, and selects read-only reconciliation before model work or a
higher-priority ordinary task. A competing submit claim returns none. The actual
adapter looks up the mock record and the guarded repository confirms one receipt.
The next selection resumes ordinary work with one assessment. Final evidence:
one CONFIRMED attempt, one receipt, one mock record, zero browser/context leaks.

Six unit scenarios cover recovery short circuit, assessment ordering, demo,
unavailable model routing and network-disabled private task sets. Final focused
unit/joined pair:7/7 pass5.65s. Separate joined recovery/compiled lifecycle group:
8/8 pass23.03s. Types, changed-file lint and production build/native237-component
SBOM pass. Full regression and clean installation run in successor CI.

No private runtime, provider/model, mailbox or employer is contacted. Actual
Windows reboot/sleep, active-browser/native-commit interruption, broad outage/
duplicate-worker/fairness matrices and elapsed24/72-hour soaks remain separate.
