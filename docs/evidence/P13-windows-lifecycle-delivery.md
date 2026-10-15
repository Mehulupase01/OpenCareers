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

## Caller-Pipe Root Cause And Final Correction

CI38716348738 at0f9c3da passes three launcher scenarios; two aggregate cases hit
their120-second test envelope. Local stage traces show the runtime already ready
in under a second while execFile waits for caller-pipe EOF until its60-second
command envelope. Its apparent success at that deadline was not prompt launcher
completion. A new check bounds pipe draining after the launcher has exited and
fails this false-green behavior within5 seconds without killing the runtime.

Redirecting stdio and clearing only standard-handle inheritance did not resolve
the inherited caller handles; those attempted implementations are removed.
Native Windows Launch now uses a small reviewed CreateProcessW wrapper with
handle inheritance disabled, explicit executable/quoted arguments/cwd, no console,
and a sorted explicit Unicode environment containing only the existing allowlist.
Returned process/thread handles and environment memory are released. It starts the
same compiled runtime, not another engine. Scheduled foreground Run is unchanged.
Implementation follows [Microsoft's CreateProcessW contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
and [creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags).

The caller-completion fixture falls from61.34s to4.07s on pinned Node24.21.0.
This is a synthetic caller-pipe measurement, not a general startup benchmark.
All27 focused launcher/host/lifecycle/ledger checks pass50.43s. An additional
compiled Windows-shaped local Start/Restart/Stop workflow passes inside the
seven-case lifecycle group30.40s: persisted control settings remain identical,
old/new owned PIDs drain, zero attempts are created, and no private
owner configuration, credentials, scheduled task or employer is used.
Independent scoped native-launch review finds no actionable issue; it is static
review, not additional runtime evidence.

Bootstrap combines version/config/authenticated status into one read-only call,
preserving version/profile checks and reducing redundant process hops. CI's Linux/
PostgreSQL failures in0f9c3da were only a ledger nextAction format mismatch. The
ledger now points at the actual open P15-G2 dependency; the cheap validator also
enforces an addressable remaining gate after engineering tickets are complete.
CI preflight now stops on its first failure, while every case still runs on a
successful build. Final corrected-build CI remains required for hosted parity.

The full suite runs once in successor CI for this narrower launcher-only batch;
the prior security batch's1,344-test local full check is not presented as evidence
for these new changes. No real private configuration, installed logon task,
physical reboot/sleep transition, employer/model/mail request, genuine receipt
or elapsed24/72-hour soak is part of this verification. P13 remains open.
