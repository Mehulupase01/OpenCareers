# OpenCareers
An AI that finds & applies jobs for you, so that you land your dream job while doing your hustle. This system uses OpenRouter API

Implementation is in progress against the Job Autopilot Production Masterplan v2.0.
The product target includes autonomous final clicks and verified real submissions
under a standing owner policy. There are no live-verified adapters yet.

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

## Engineering Evidence

- [Architecture](docs/architecture.md)
- [Requirements](docs/requirements.md) and [amendments](docs/amendments.md)
- [Phase ledger](docs/phase-ledger.json) and [current handoff](docs/HANDOFF.md)
- [Adapter support](docs/adapter-support.md)
- [Security model](docs/security/threat-model.md)
- [Sources](docs/sources/research.md)

No real candidate data or credentials belong in Git. Public demos and CI use the
owned mock ATS. Live success requires correlated employer receipt evidence.
