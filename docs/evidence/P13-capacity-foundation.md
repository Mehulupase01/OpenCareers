# Synthetic Capacity Foundation

2026-10-11. `corepack pnpm capacity` runs only an isolated owned-mock workload.
It accepts no private data path, profile, credentials or external target URL.
Every run creates fresh marked SQLite storage in an OS temporary directory.
Fixture seeding rejects existing application/profile/fact/answer corpora and
redirected paths. Repository .env is never imported. There are no real model
calls or employer submissions; letters and matching are explicitly labelled
deterministic synthetic fixtures and reviewed assessment replays.

The driver exercises production packet generation, local artifacts, canonical
form-answer validation, persistent browser preparation, queue leases, the sole
guarded submission repository, correlated mock receipts and read-only recovery
after acceptance/response loss. It asserts exact expected outcomes, no duplicate
attempt, and exactly one server record for accepted jobs or zero for blocked
and rejected jobs. It never solves the challenge fixture.

Nine workload cases: standard, challenge, upload failure, changed question,
response loss, validation rejection, rejected-fit replay, simulated 250ms model
delay and synthetic account friction. The last three are workload simulations,
not new live matching, provider latency or account-creation evidence.

Two explicit scenario runs completed: 60.144 seconds and 30.152 seconds, nine
cycles each. Outcomes: three confirmed (one recovered read-only), one definitive
rejection, and five blocked/skipped/friction results. The earlier 60-second run
ended with zero pending tasks, maximum task attempts 1, 4,334,949 measured bytes
in 66 filesystem entries, approximately 323 MB sampled Node RSS, browser/context
peak 1 and zero resources remaining. The later run adds exact outcome/server
assertions and per-stage packet/preparation/commit/reconciliation timings.
These samples are smoke measurements, not growth proofs or a 24/72-hour soak.

Reports are bounded JSONL: start metadata, full-corpus queue counts grouped by
type/state, receipt-backed flow, disk entries/bytes, Node memory, browser resource
counts, stage timings and finish/failure status. Limits: 216 cycles, 50 pending
tasks, four task attempts, 512 MiB storage, 20,000 traversed entries, 1 GiB Node
RSS, 25 MiB report and 9,000 records. Bounds fail the run rather than truncate
evidence. Samples hash runtime sources and imported fixture data; source changes
or excessive sampling gaps invalidate measurement. Cancellation is interrupted,
not completed duration evidence. No report can close a production soak gate
automatically (`productionSoakGateSatisfied` is always false).

Shared mock/handoff/Greenhouse browser entry points now use one resource tracker
per process. Browser and context limits are four each, including opening
reservations, with cleanup on actual close/disconnect. Failed launches and
context creation release reservations. This is not a cross-process host limit.
Chromium inherits only allowlisted OS/display essentials, not owner tokens,
OpenRouter keys, vault keys or arbitrary app environment secrets. Cookie/session
and dispatch permissions remain controlled by existing adapter contracts.

Example smoke command:

```powershell
corepack pnpm capacity --duration 30 --interval 1 --sample 10 --cycles 9
```

The CLI prints its report location at startup. Long durations are supported up
to 259,200 seconds, but none were run. Node memory excludes Chromium child RSS;
source hashes are not proof of an independently installed full runtime. Whole-host
measurements, continuous workload scheduling, installed-runtime operation,
24/72-hour wall-clock evidence and live ramp remain required. P13-04 is in progress.

Unit/integration resource, isolation, cancellation and guarded-cycle tests pass.
The full local checkpoint passed 622 tests / 216 PostgreSQL skipped in 76 files,
plus lint/types/ledger/build and all 60 browser cases. Final stop-control additions
are separately covered in `P13-stop-controls.md`; successor CI remains pending.
