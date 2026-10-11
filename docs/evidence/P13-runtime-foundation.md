# P13 Independent Runtime Foundation

2026-10-11. P13 remains open. No private installation, scheduled task, real
application, OS reboot or qualifying 24-hour soak has been performed.

## Implemented

- The compiled local/demo launcher runs API then scheduler without a dev server,
  editor or Codex. It waits for API readiness and a current-generation scheduler
  heartbeat. Old, future-dated and over-90-second heartbeats do not satisfy it.
  Both probes verify the newly generated instance identity, not an old API that
  happens to occupy the desired port.
- A shared supervisor drains both children through IPC on stop or failure,
  forces termination after the shutdown bound, and restarts with capped
  exponential backoff. At most six restarts per ten minutes are allowed. An
  interrupted attempt stays governed by existing lease/fence/reconciliation
  rules; the supervisor never invokes submission or changes an outcome.
- Worker heartbeats continue during long tasks without an unbounded chain of
  pending heartbeat writes. API and worker also drain on parent IPC disconnect.
- An installation-scoped loopback listener serializes startup and stale-record
  recovery. Duplicate starts are refused. Its status/stop commands require an
  independent nonce held in the owner's local runtime record. No token appears
  in arguments, status responses or logs. A control-port collision fails closed.
- Runtime schema 1 is explicit; future/corrupt metadata is refused, not silently
  migrated. Dead-owner records can recover after a five-second safety interval.
  Junction/symlink data redirection is refused; synthetic guards precede metadata.
- Metadata-only events rotate at 1 MiB into three older files. Raw child output,
  profile text, keys and request bodies are not persisted. Only validated error
  codes from a fixed allowlist are retained for diagnosis. A regression test
  rejects an arbitrary uppercase private-looking code and raw payload. This
  is not whole-application retention.
- The Windows PowerShell launcher supports hidden start, status and graceful
  stop. Current-user, non-elevated logon task installation/removal requires
  explicit `-ApproveStartup` and supports `-WhatIf`. No task was installed.
  Startup is interactive/logon-scoped, not promised while logged out.
- Explicit absolute config files load without reading the repository `.env`;
  child processes inherit that configuration with automatic env-file loading
  disabled. Server/hybrid installation is not provided by this local launcher.

## Actual Evidence

`tests/integration/worker-lifecycle.test.ts` launches real processes. It verifies
IPC drain, actual worker SIGKILL recovery, health-failure restart exhaustion,
forced shutdown, and no leaked children. A detached parent launches the compiled
application and exits; API/worker remain healthy. That actual application then
refuses a duplicate launch, denies unauthenticated stop, recovers from its actual
scheduler kill and stops through authenticated local control. A future runtime
record is unchanged after refusal. Explicit config validation does not load the
owner's repository env. Windows startup is tested as a dry-run with/without the
approval switch; this is not an installed-task or reboot test.

API tests also reject stale/future and previous-generation heartbeats. The
initial detached test caught metadata creation preceding the synthetic guard;
the implementation was corrected, not the guard relaxed. Windows dry-run tests
also corrected script initialization and isolated OS-environment handling.

Final full-suite, browser and CI results are recorded at the milestone in the
handoff: frozen 577/189 skipped, 70 files and all 58 browser cases; final
handshake/diagnostic hardening passed 22 focused lifecycle/API tests. Successor
CI 38131370706 at `370e584c60a0bc5d66e5fbacb82f344230a196c3` is green on
Windows, Ubuntu and PostgreSQL. The real compiled application remains healthy
after its detached parent exits; this closes G1 runtime independence, not the
P13 phase or installation/reboot requirements. Real shutdown
recovery of ambiguous submission outcomes is also covered by existing guarded
engine tests, not represented as a genuine employer submission.

## Remaining

Owner-approved actual startup installation, clean Windows packaging, scheduling,
complete capacity and actual 24-hour soak,
sleep/wake and network-loss verification, whole-application bounded retention,
and genuine receipt-backed ramp are still required. P14 server/hybrid and P15
restore/security/72-hour soak remain. No background Codex continuation was set up.
The operational target readout is now complete; the synthetic capacity foundation
and stop-control acceptance are recorded separately in their P13 evidence files.
The isolated hidden startup host and disposable process verification are described
in `docs/evidence/P13-windows-startup-host.md`; actual task installation is still
unverified.
Periodic heartbeat/renewal writes are now single-flight; see
`docs/evidence/P13-periodic-work.md` for the bounded backlog proof and remaining
database/hardware/soak limitations.
