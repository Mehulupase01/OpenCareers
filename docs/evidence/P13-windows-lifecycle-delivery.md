# Windows Lifecycle Delivery

2026-10-15. P13-01 engineering delivery, not physical reboot or soak evidence.

## Implemented Workflow

The Windows launcher now supports Restart and bounded readiness waits. Start
returns authenticated running status, not merely successful process creation.
An already authenticated running runtime is reused; an owned nonrunning runtime
refuses another launch. New hidden startup waits up to TimeoutSeconds (default60,
range5-120) plus the bounded status probe overhead. Failure warns that a process
may remain starting and requires inspection rather than deleting ownership state.

Restart obtains the runtime PID from authenticated loopback control, captures that
process, requests graceful stop, verifies the shutdown response has the same PID,
and waits for that process to exit before starting a replacement. Failed control,
changed ownership or a hung shutdown refuses replacement. No arbitrary PID kill,
control-record deletion or startup-task modification is performed. Runtime PID is
additional authenticated status metadata; the supervisor's child-PID contract is
unchanged. Windows startup installation remains separately owner-approved.

Pause, emergency stop, authorization, inference privacy and final-action guards
are unchanged. Restarts cannot themselves grant submission authority. Existing
durable queue recovery and read-only uncertain-outcome reconciliation remain the
owners of interrupted work. The launcher does not migrate code or roll back data.

## Verification

Actual compiled lifecycle and isolated startup-host group: nine passed in20.90s.
This includes detached parent survival, authenticated runtime-PID identity,
duplicate ownership refusal, killed scheduler recovery, graceful draining,
environment isolation and startup approval/WhatIf. Typecheck and production
build/native237-component SBOM pass. Five launcher fixture checks pass31.86s,
covering delayed readiness, idempotence, explicit spaced paths/environment isolation,
ordered restart, failed/hung startup, unknown/nonrunning ownership, hung shutdown
and Start/Restart WhatIf. The owner-policy fixture file remains byte-identical;
this is not a live candidate-policy or employer recovery drill. Fixtures use the
real PowerShell launcher/host around a disposable Node control server. The actual
compiled runtime identity/drain checks above are separate integration evidence.
No needed test process remains running. Lint/types/ledger pass; public-source
scan551 files before final acceptance documentation.

The full suite runs once in successor CI for this narrower launcher-only batch;
the prior security batch's1,344-test local full check is not presented as evidence
for these new changes. No real private configuration, installed logon task,
physical reboot/sleep transition, employer/model/mail request, genuine receipt
or elapsed24/72-hour soak is part of this verification. P13 remains open.
