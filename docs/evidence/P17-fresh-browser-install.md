# Windows Installation With A Fresh Browser Cache

2026-10-12. The opt-in extracted distribution test now starts with an absent,
owned Chromium cache beside its fresh installation. It installs production
dependencies and runs the installed Playwright CLI to download matching
Chromium there. A separate installed Node process resolves the real browser
executable and verifies that it resides under that cache, not a pre-existing
global browser installation. No TypeScript or tsx is installed in the bundle.

Every installed subprocess inherits only the test's selected runtime environment.
Native integrity verification runs before installation. Compiled packet
generation, smoke receipts, actual-lease crash recovery, encrypted mock handoff,
API/dashboard boot, scheduler health and authenticated shutdown then execute
against the isolated installation. Injected private application settings remain
ignored by the synthetic smoke/recovery commands. Recovery forwards only the
explicit browser cache plus OS/runtime variables to its owned child, excluding
owner tokens, vault keys, private data/database settings and inference keys.

Local extracted Windows result: 1/1 passed in 104.96 seconds, including a real
fresh browser download. Focused recovery/bundle/context suite: 11/11. Added
environment allowlist test proves private settings are removed. Types, lint and
production build pass. Prior full server-foundation regression: 732 / 259 skips
in 97 files; it is not relabelled as a full successor run. Successor CI pending.

Published bundle INSTALL.md already includes browser installation and the two
compiled self-tests. This closes the previous hidden shared-browser-cache gap,
not a clean operating-system installation or live private readiness. The machine
still has the documented Node/pnpm/system prerequisites and registry access.
No private CV/browser session, live model/mail access or employer action occurred.
P17-G1 awaits the successor Windows CI proof; no phase closes at this milestone.

The independent server image lane at d03f9c6 built the image and passed its
network-isolated mock leg, but Compose failed when its worker became unhealthy.
That run did not capture service logs before cleanup. Bounded synthetic-only,
token-redacted diagnostics are added for the next lane run; the cause is not
yet established. It is neither a green deployment claim nor evidence of a
particular root cause. Remaining TLS, PostgreSQL application-flow and hybrid
requirements are unchanged.
