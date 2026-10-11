# OpenCareers
An AI that finds & applies jobs for you, so that you land your dream job while doing your hustle. This system uses OpenRouter API

Implementation is in progress against the Job Autopilot Production Masterplan v2.0.
The product target includes autonomous final clicks and verified real submissions
under a standing owner policy. There are no live-verified adapters yet.

## Current State

The ledger records P00-P07 and P09 complete, with P08 awaiting a genuine
receipt, P10 reopened for remaining recovery gates, and P11-P18 open. Existing behavior includes reviewed candidate evidence,
standing authorization, durable SQLite/PostgreSQL work, three public ATS discovery
families, evidence-bound matching and documents, guarded submission adapters,
accounts, challenge handoffs and an exception inbox. Mock submissions are verified;
Recruitee and Greenhouse application variants are fixture-tested, not live-verified.
Private document/source encryption and an audited restore quarantine are implemented;
existing plaintext files require an explicit offline upgrade. Database facts are not
encrypted, and whole-installation restore/release gates remain open. Known workflow
and security gaps are being repaired before production activation.
See [production completion](docs/plans/PRODUCTION-COMPLETION.md) for the full scope.

## Development

Node 24 LTS (release pin in `.node-version`), pnpm 12.4.2. Windows is supported.

```powershell
npx --yes pnpm@12.4.2 install --frozen-lockfile
npx --yes pnpm@12.4.2 doctor
npx --yes pnpm@12.4.2 dev
```

The dashboard uses http://127.0.0.1:4318 and API http://127.0.0.1:4317 in development.
Demo data is synthetic and stored in `.data/demo`. Real data belongs outside the
repository on a non-synced disk. `.env.example` documents configuration.
Optional OpenRouter inference requires a private key plus explicit `:free` model and
provider allowlists. Unknown prices, fallback providers and tools fail closed. Demo
mode uses synthetic inference and sends no data to OpenRouter.

Commands: `dev`, `build`, `lint`, `typecheck`, `test:unit`, `test:integration`,
`test:e2e`, `doctor`, `demo:reset`. Commands still under development must not be
reported as verified; see the handoff for actual results.

`corepack pnpm capacity --duration 30 --interval 1 --sample 10 --cycles 9`
runs the isolated owned-mock capacity driver and prints its bounded JSONL report
location. It accepts no private profile or external target. Matching/model delay
are fixture simulations and memory covers the Node driver, not Chromium children;
short runs do not satisfy production soak gates. See
[capacity evidence](docs/evidence/P13-capacity-foundation.md).

After building, the local Windows launcher supports `Start`, `Status`, `Stop`,
`InstallStartup` and `RemoveStartup`. Supply `-ConfigFile` with an absolute
private configuration path and `-NodePath` with the pinned Node executable to
`scripts/windows-runtime.ps1`. Startup changes require `-ApproveStartup`;
`-WhatIf` previews them. The hidden host isolates Node's environment and returns
its exit status. Actual installed-task/reboot verification remains open; see
[Windows runtime evidence](docs/evidence/P13-windows-startup-host.md).

`corepack pnpm bundle:windows` rebuilds a checksummed, precompiled runtime ZIP
in a fresh temporary directory. Its `INSTALL.md` describes production-only
dependency installation and guarded startup. Private data and dependencies are
not bundled. After installation, `node dist/scripts/release-smoke.js` runs a
fresh, bounded mock-only workflow with guarded receipts, lost-response
reconciliation and ambiguous-form blocking. It ignores private profile settings
and accepts no target overrides. This is not yet an accepted final release.
See [bundle evidence](docs/evidence/P13-windows-bundle.md) and
[packaged workflow evidence](docs/evidence/P17-packaged-workflow.md).

Browser tests use separate loopback ports 14317/14318 for desktop and 14319/14320
for mobile, and never reuse an existing server. Override them with
`AUTOPILOT_E2E_API_PORT`, `AUTOPILOT_E2E_WEB_PORT`, `AUTOPILOT_E2E_MOBILE_API_PORT`
and `AUTOPILOT_E2E_MOBILE_WEB_PORT` if occupied. Your private service on 4317/4318
can remain running. Tests force the
synthetic demo profile and refuse any server reporting a private profile.
Each run and viewport project gets a fresh guarded `.data/e2e/<run-id>` database; your normal demo
workspace is neither reset nor reused. These synthetic test files stay ignored.

## Validation

Verification counts and exact commands are recorded in
[baseline recovery](docs/evidence/BASELINE-RECOVERY.md) and
[workflow recovery](docs/evidence/WORKFLOW-RECOVERY.md), with PostgreSQL skips and
local versus CI results distinguished. Earlier phase evidence remains historical;
passing synthetic tests does not establish live employer support.
See [encryption and restore](docs/evidence/ENCRYPTION-RESTORE.md) before upgrading
legacy private files or booting an offline backup.

```powershell
npx --yes pnpm@12.4.2 check
npx --yes pnpm@12.4.2 exec playwright install chromium
npx --yes pnpm@12.4.2 test:e2e
```

For the PostgreSQL contract, set `AUTOPILOT_TEST_DATABASE_URL` to a dedicated disposable
test database and `REQUIRE_POSTGRES_TESTS=1`. Otherwise PostgreSQL tests are skipped.
Never point test commands at a private application database. See the
[persistence contract](docs/persistence.md) and [P02 evidence](docs/evidence/P02-verification.md).

## Engineering Evidence

- [Architecture](docs/architecture.md)
- [Requirements](docs/requirements.md) and [amendments](docs/amendments.md)
- [Phase ledger](docs/phase-ledger.json) and [current handoff](docs/HANDOFF.md)
- [Adapter support](docs/adapter-support.md)
- [Security model](docs/security/threat-model.md)
- [Sources](docs/sources/research.md)

No real candidate data or credentials belong in Git. Public demos and CI use synthetic
fixtures; the owned mock ATS is implemented. Live success requires correlated
employer receipt evidence.
