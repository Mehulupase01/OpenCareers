# Windows Startup Host

2026-10-11. The local launcher now routes startup, configuration validation,
version checks and status/stop through an isolated Windows PowerShell host.
The host launches Node with UseShellExecute=false, CreateNoWindow=true and a
cleared environment containing only OS essentials and AUTOPILOT_SKIP_ENV_FILE=1.
Application configuration comes from the explicit absolute config file, not
arbitrary inherited shell variables. Paths containing spaces are preserved.

The scheduled action waits for the runtime and propagates its actual exit code
so Task Scheduler's bounded restart policy can observe failure. Manual start
still uses Start-Process -WindowStyle Hidden; no interactive window is requested.
Validation/control output is returned only on successful child exit. A trailing
newline initially made PowerShell treat the version as multiple lines; the
host now trims it before emitting its successful output.

Two Windows-only disposable process tests prove exit code 17 propagates,
explicit spaced paths reach the child, inherited router/owner/vault keys and
NODE_OPTIONS do not, env-file loading is disabled, and successful validation,
status, stop and pinned-version output return. The existing real compiled
lifecycle suite validates a synthetic local config and checks that startup
installation requires -ApproveStartup and supports -WhatIf. These nine focused
tests pass locally. No owner's config, private DB or existing task is used.

This is not evidence of an installed logon task, reboot/sleep/wake, clean release
installation or private submission. P13-01 remains in progress. No startup task
was registered or removed. The launcher's current-user interactive logon scope
does not promise operation while logged out.

The process settings follow the [Microsoft ProcessStartInfo documentation](https://learn.microsoft.com/en-us/dotnet/fundamentals/runtime-libraries/system-diagnostics-processstartinfo-useshellexecute).
