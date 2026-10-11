# Packaged Synthetic Crash Recovery

2026-10-12. The compiled Windows distribution includes a second bounded
self-test, `node dist/scripts/release-recovery.js`. It accepts no options,
loads no env file, and selects fresh canonical synthetic TEMP storage itself.
Its child receives only OS/runtime environment variables, never private app
configuration. Target/path overrides are rejected before opening storage.

The child uses the existing preparation and guarded submission engine. After
the mock accepts the response-loss application, its browser is closed and the
durable attempt is still dispatched/IN_FLIGHT. The supervisor kills only that
owned child, opens the same authoritative SQLite database, waits for the actual
task lease expiry, and claims the existing engine's read-only reconciliation
work. The correlated receipt resolves the original attempt. No second final
action is performed. The run checks exactly two confirmed attempts, two distinct
accepted mock records and no unresolved UNKNOWN outcomes.

A separate blocked synthetic challenge uses the existing handoff lease,
generation fencing and encrypted browser checkpoint. Its owned loopback fixture
Continue control is clicked, the checkpoint is verified and decrypted through
the normal continuation contract, and zero challenge attempts are asserted.
The generated encryption key is ephemeral. This is a test-only checkpoint,
not a persistent private handoff installation or challenge-resumed submission.
It neither solves nor bypasses a real CAPTCHA or access control.

Worker failure is reported over IPC without private error text. Spawn errors,
early exits and missing boundaries fail closed; owned child closure is awaited.
All broker/database resources close in finally. Failed runs remove only the
fresh directory they created; successful synthetic evidence is retained.

Focused source test passed (40.21 seconds). The frozen recovery batch's full
check passed: 728 tests / 258 skips in 95 files, with lint, types, ledger and
production build. Extracted production-only Windows installation passed 1/1
(62.94 seconds), running the compiled IPC worker without tsx, ignoring injected
private profile/database settings and rejecting target overrides. The archive
also passes native integrity checks and boots/stops its independent runtime.
Public-source scan passed 446 selected files before independent server work.
The prior native-integrity commit 9aa8ca3c15753d4aa3e81403aa3cf3ed579e73a0
passed all Windows, Ubuntu and PostgreSQL lanes in CI 38181899971. Successor
recovery CI remains pending at this milestone.

Limits: assessments and letters are reviewed synthetic fixtures, not real
matching or mandatory production OpenRouter generation. This is not a physical
reboot, real employer receipt, installed startup, server/hybrid deployment or
actual-duration soak. `productionReleaseAccepted` remains false. No additional
phase or gate is closed by this extension.
