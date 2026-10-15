# Windows Lifecycle Delivery

2026-10-15. Windows-first continuation of P13-01, after the retained-letter
security correction. This does not replace physical reboot/sleep or elapsed soaks.

## Delivery Contract

- Start waits a bounded interval for the authenticated managed runtime to report
  running, rather than returning success merely because PowerShell spawned.
- Restart uses the existing authenticated shutdown, waits for the old runtime
  host to exit, then starts the same explicit installation/configuration. Never
  kill an arbitrary PID, clear a control record, or force an ambiguous startup.
- A failed or hung shutdown refuses replacement. A failed startup reports failure
  without changing owner policy or claiming that no process remains.
- Keep hidden process launch, environment isolation, explicit config paths and
  the single runtime mutex. Start is idempotent only for an authenticated running
  runtime; stale/inaccessible control must fail closed through existing ownership.
- Restart does not unpause submissions, grant authorization, replay an uncertain
  attempt or change inference privacy/quotas. Existing queue and final engine
  continue to own recovery.
- Support ShouldProcess/WhatIf for lifecycle changes and retain explicit approval
  for startup installation/removal. No real owner's startup task is changed.

## Evidence

Use disposable compiled synthetic runtimes and fixture processes to exercise
readiness, orderly restart, timeout refusal, explicit spaced paths and stop/pause
preservation. Run focused lifecycle checks while developing, then one milestone
check/build and existing packaged installation verification. Physical Windows
reboot, sleep/wake, employer submissions and 24/72-hour soak gates remain open.
