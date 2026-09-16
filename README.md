# OpenCareers
An AI that finds & applies jobs for you, so that you land your dream job while doing your hustle. This system uses OpenRouter API

Implementation is in progress against the Job Autopilot Production Masterplan v2.0.
The product target includes autonomous final clicks and verified real submissions
under a standing owner policy. There are no live-verified adapters yet.

## Current State

P00 architecture, P01 runnable foundation and P02 persistence are complete. The dashboard reads real
database state for synthetic jobs, tasks, controls and worker health. P02 provides durable
queue ownership, cancellation, audit events and crash recovery on SQLite/PostgreSQL.
P03 candidate onboarding is complete and verified locally and on GitHub:
PDF/DOCX source import, reviewed facts, immutable profiles, scoped answer memory and
revocable standing authorization. Discovery, document generation and final submission
are still ahead; the current application does not apply to employers.

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

Commands: `dev`, `build`, `lint`, `typecheck`, `test:unit`, `test:integration`,
`test:e2e`, `doctor`, `demo:reset`. Commands still under development must not be
reported as verified; see the handoff for actual results.

## Validation

The current local suite passes 79 tests with both databases configured. This includes
four-process claim races, forced worker termination, disk-full rollback, PostgreSQL
connection loss and populated-schema upgrades. Desktop/mobile browser workflows
are tested separately (4 passed). Windows, Linux and PostgreSQL CI passed for P03.
See [candidate verification](docs/evidence/P03-verification.md).

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
fixtures; the owned mock ATS is planned for P07. Live success requires correlated
employer receipt evidence.
