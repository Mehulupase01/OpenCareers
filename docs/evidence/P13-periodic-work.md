# Bounded Periodic Worker Writes

2026-10-11. The scheduler's lease-renewal timer previously appended each tick
to a promise chain. A stalled renewal could retain an arbitrarily long backlog
during a long task. Heartbeat and renewal now use one tested periodic primitive:
at most one outstanding operation per timer; ticks during that operation are
skipped, not queued. A later tick can retry after failure. Stop disables future
ticks and drains the one outstanding operation, preserving existing shutdown
ordering. Synchronous work/diagnostic errors cannot strand the single-flight
slot or leave a background rejection unhandled.

This is not a database timeout or cancellation primitive. A stalled write can
still await the runtime supervisor's existing bounded shutdown/forced termination.
The main-loop heartbeat and other DB operations are outside this per-timer bound.
Submission permits, lease/fence checks, reconciliation and authority are unchanged.

Four fake-timer tests cover 1,000 ticks with one blocked write, drain and no
queued replay, next-tick retry, synchronous failures, stop-before-start and
interval bounds. This compressed clock is unit evidence, not a real-duration
soak. Thirteen focused periodic/lifecycle/host tests pass; the preceding focused
run also passed both guarded emergency-stop workflows.

CI 38141281221 at 1d8f194 passed Ubuntu/PostgreSQL but failed Windows at the
installer's 45-second preflight timeout, before the clean-install step. That
run does not verify the Windows bundle. The launcher no longer starts redundant
nested PowerShell processes for version, validation and status/stop: it invokes
the existing isolated host in script scope. Node still receives a cleared,
OS-only environment and explicit config. Actual hidden startup and the scheduled
action remain separate PowerShell processes. Local approval/WhatIf and exit-code
tests pass without changing the timeout. The precise runner timeout cause is
not established; successor CI must verify the fix.

Whole-host measurement, installed logon startup, hardware fault drills, real
24/72-hour soaks and genuine receipts remain open. No new phase or gate is closed.

Final local verification: pnpm check passes 635 tests / 217 skipped in 81 files,
lint/types/ledger/build; the updated production-only clean installation also
passes packet validation, unknown-answer blocking, compiled API/dashboard
readiness, manager exit zero and absence of both worker PIDs after stop.
Public-source scan passes 383 files. The new draft bundle's SHA-256 is
c28be86ec60126815f99ad292b40d56cd3b5a38631f0bf36b0c7a8ae0681f129.
