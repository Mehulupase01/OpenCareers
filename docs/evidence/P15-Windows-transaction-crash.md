# Open SQLite Transaction Crash Recovery, 2026-10-14

Extends the existing owned synthetic commit-crash matrix from six to eight cases.
No production database/submission contract acquires fault hooks or another final
action authority. Instrumentation wraps the owned fixture's Database interface,
delegating real statements and transactions to the existing SQLite implementation.

## New Boundaries

- `intent_transaction_open`: after the guarded begin operation has inserted the
  intent/attempt, updated application state and written audits, but before its real
  transaction callback returns to execute SQLite COMMIT. The worker reads the staged
  attempt from inside the open transaction and reports it over owned IPC. It waits
  inside that callback until the supervisor kills the actual child with SIGKILL.
- `receipt_transaction_open`: after actual mock acceptance and browser cleanup,
  receipt insertion plus application/attempt confirmation have executed inside the
  existing transaction, but its callback has not returned/committed. Both staged
  attempt/receipt rows are verified in that transaction before IPC/kill.

The parent validates boundary-specific open-transaction/staged-row IPC, actual child
exit signal and zero owned browsers, then cold-reopens the database. quick_check and
foreign_key_check must pass. Rolled-back intent leaves no intent/attempt/receipt and
the application READY; only pre-intent work can receive another submit lease/fence.
Rolled-back receipt leaves one durable intent/attempt, no receipt and the application
IN_FLIGHT before recovery. Existing read-only reconciliation locates the already
accepted mock record and records its correlated receipt. Distinct-key submit
redelivery and repeated worker claims still cannot dispatch again.

All eight cases independently compare actual persisted mock records and receipts.
Expected final outcomes are four accepted/receipted records, two needs-review cases
and two safely retryable pre-intent cases, with zero duplicate external records.
Lease recovery uses an explicit logical clock after the persisted deadline; the
separate release-recovery drill waits actual elapsed lease expiry.

## Verification And Limits

Initial focused eight-boundary run passes in44.59s. Final additional cold-state
assertions pass in the frozen full check:870 tests /285 local skips,109 passing
files /two skipped in328.22s. Lint/types/ledger/build/SBOM generation pass with
the existing lint/chunk warnings. The separate COMPILED `node
dist/scripts/commit-crash.js` command passes all eight actual kills, including both
open write transactions. Both cold-state assertions and database consistency pass;
four accepted records have receipts, two uncertainty cases remain needs-review and
two pre-intent cases remain safely retryable. Zero duplicates and zero leaked browsers.
The local compiled JSON is retained at `%TEMP%/opencareers-transaction-crash-compiled.json`;
its owned synthetic matrix directory remains for inspection. No private data/config,
LLM, Gmail, employer, real submission, physical reboot or startup-task action occurs.

These are real kills during OPEN SQLite write transactions, not callback exceptions
or injected SQL failures. They do NOT kill inside SQLite's native COMMIT critical
section, cut disk power, exercise a live Chromium click or prove physical BSOD/reboot
recovery. Browsers close before all process kills. Network/duplicate-worker/fairness
scope, active-browser/native-COMMIT interruption, provider revocation, physical
Windows recovery and actual24/72h soaks remain open. No phase or gate is closed.
