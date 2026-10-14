# Windows Owned Commit Crash Matrix

2026-10-14. Synthetic SQLite/mock-ATS process-kill evidence, not a private employer
submission, physical reboot or qualifying soak. Phase counts stay12/19 and98/128.

The installed Windows command `node dist/scripts/commit-crash.js` accepts no options
and uses only newly allocated synthetic storage. Workers receive the existing OS/
browser-cache environment allowlist, never owner config, model/mail keys or private
data paths. Each worker's fixture verifies its isolated synthetic marker, owner,
empty application corpus and SQLite dialect before creating reviewed fixture packets.
No final-action engine or adapter authority was duplicated or widened.

## Boundaries

| SIGKILL Boundary | Accepted Mock Records | Recovery |
| --- | --- | --- |
| Claimed task, no intent | 0 | Work remains retryable with a new lease fence |
| Durable intent, no dispatch permit | 0 | Missing receipt remains needs-review; no replay |
| Dispatch authorized, no final click | 0 | Missing receipt remains needs-review; no replay |
| Employer accepted, receipt not persisted | 1 | Read-only reconciliation confirms existing receipt |
| Receipt insertion failed and rolled back | 1 | Read-only reconciliation confirms existing receipt |
| Receipt committed, task completion not written | 1 | Expired task completes without another final action |

The supervisor verifies the declared boundary and zero tracked browser/context
resources, kills only its spawned ChildProcess, waits for close and requires a real
SIGKILL exit. Child database finally/close code does not run. Cold startup reopens
the durable store. The receipt-write case installs a trigger only in this owned
synthetic SQLite database; the exact injected storage error must occur before the
boundary counts. The trigger is removed after the kill before receipt reconciliation.

After the initial recovery, distinct-key queue redeliveries and repeated worker claims
cannot create another attempt or dispatch a recorded final action. The mock server is
reopened from persisted files, independently checks one record per accepted job and
is compared with receipt/attempt counts. Receipt-free uncertainty is not converted to
"not sent" or automatically retried. Pre-intent work is retained rather than dropped.

## Evidence And Limits

Final focused source matrix plus bundle contracts:24 passed /one skipped, three files,
34.80 seconds. Every declared worker boundary was reached, browser resources were
closed, exits were SIGKILL and zero duplicate records occurred. Full frozen successor
`pnpm check` passes859 tests /283 local skips,107 passing files /two skipped,
317.90 seconds, plus lint/types/ledger/build. Existing browser-helper lint and web
chunk-size warnings remain. Separate standalone COMPILED Node command also passes
all six cases: three mock records with receipts, two needs-review outcomes and one
retryable pre-intent task, zero duplicate records. Its generated synthetic output was
removed only after validating the canonical owned TEMP directory. Successor CI is
pending; the prior recovery commit227ed49 passes all four CI lanes in38533858069.

Lease recovery here uses a declared logical clock immediately after the persisted
deadline, not fictitious elapsed time. The existing release-recovery test separately
waits for an actual lease before recovery. The authorized/no-click case injects an
authorization-callback error, allows normal browser cleanup, then kills the worker.
It is NOT an unexpected process kill inside an active Chromium final action. Receipt
failure rolls the transaction back before the kill; it is not an arbitrary physical
kill partway through SQLite commit. These distinctions are deliberate to avoid orphan
browsers and false crash claims.

This starts P15-02 and G2 evidence. Live-browser/transaction kill coverage, the complete
network/duplicate-worker/expiry/redelivery matrix, queue fairness and actual power-loss/
reboot/resource/soak requirements remain. Existing concurrency, durability, emergency
stop and lost-response tests are retained, not replaced by this harness. No phase or
broader crash gate closes merely because these six cases pass.
