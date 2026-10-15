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

## Hosted Windows Correction

CI38711591671 at e21cd34 passes Ubuntu, PostgreSQL and server-image, but all five
Windows launcher cases fail: the extra hidden PowerShell hop never reaches the
synthetic runtime. The exact runner-specific cause is not established; this is
not treated as a successful installation or solved by increasing readiness waits.

Manual Start/Restart now invoke the isolated startup host's Launch command, which
uses the same detached Node pattern already proven by compiled lifecycle checks.
The production runtime CLI owns this operation; its PID is returned and matched
against authenticated readiness. No extra hidden PowerShell host, inherited console
or untrusted output channel is needed. Scheduled logon still uses the foreground
host so Task Scheduler receives the real runtime exit code. No policy is bypassed.

The standalone lifecycle fixture now calls the production launch command instead
of maintaining a separate test-only launcher. All14 focused launcher/host/compiled
cases pass184.44s; types/lint/build/native SBOM pass. Windows CI runs the five
launcher cases before browser download/full regression and excludes only those
already-run cases from the later full step. Total coverage is unchanged, not
duplicated. The overall CI job bound becomes25 minutes for the accumulated suite,
clean install and browser workload; per-test, readiness and shutdown limits stay
unchanged. Corrected-build Windows CI is still required before claiming parity.

## Bounded Control Protocol

CI38714097993 at45f91c8 still fails the Windows fixture preflight: its25-second
outer command deadline expires with no captured reply. Empty capture did not prove
Node had printed nothing: the host withheld output until synchronous EOF and an
unbounded process wait both completed. A scoped independent review identified
those unbounded waits; it did not establish a specific OS or inherited-pipe cause.

The host now reads the single-line control protocol asynchronously and bounds
client exit/reply waits. Control deadlines are min(TimeoutSeconds,15) seconds;
foreground Run remains intentionally continuous for Task Scheduler. Only a timed-out
owned control client can be killed, never its detached managed runtime child.
No ownership record is deleted and a failed control never authorizes replacement.

Pinned CI Node24.21.0 was downloaded from the official distribution and checked
against its published SHA256; no global runtime or dependency was changed.
On that exact version, launcher/host8/8 pass168.63s, including a genuinely hung
control client that is stopped and verified gone. Compiled lifecycle7/7 passes
24.39s with the production launch command. A standalone healthy launch case also
passes26.90s. These are focused local results, not hosted-runner parity.

Healthy fixture startup uses15 seconds within the production default60; deliberate
readiness/hung-shutdown cases retain5-second limits. The test command envelope is
60 seconds and multi-command cases120 seconds, rather than a25-second envelope
that could expire before several separately bounded operations. Fixture self-expiry
covers that envelope. Synthetic command-stage traces are attached only on failure;
they contain no real account/candidate/model data. New hosted CI is still required.

The full suite runs once in successor CI for this narrower launcher-only batch;
the prior security batch's1,344-test local full check is not presented as evidence
for these new changes. No real private configuration, installed logon task,
physical reboot/sleep transition, employer/model/mail request, genuine receipt
or elapsed24/72-hour soak is part of this verification. P13 remains open.
