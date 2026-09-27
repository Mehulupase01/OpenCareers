# P09 Variant Coverage Verification

Verified 2026-09-27 at `b2de20cd9ec8296d29ec2f9e344f7423b8cc44e6`.

The Discovery coverage API combines owner-scoped open-vacancy counts with a
separate curated variant matrix. The matrix records adapter version, dated
public or fixture evidence, account/challenge observations, stage-specific
support levels and limitations. The Adyen Greenhouse and Protolabs Lever
hosted forms remain public-read-only and challenged; neither is marked
commit-ready or live-verified. Recruitee commit and receipt are fixture-tested,
not privately live-verified. The owned mock ATS is explicitly synthetic.
No variant is currently labeled live-verified, and no real submission or
private receipt is claimed.

`corepack pnpm check` passed locally: 121 tests, lint, typecheck and build;
55 PostgreSQL-dependent tests were skipped in the local suite. The SQLite
coverage integration test and desktop/mobile Discovery E2E passed locally.
`corepack pnpm public:scan` passed 174 files. Fresh GitHub Actions run
[`36327443129`](https://github.com/Mehulupase01/OpenCareers/actions/runs/36327443129)
passed Windows, Ubuntu and PostgreSQL jobs, including the full browser suite.

P09-G5 reporting is complete. This does not satisfy second-family synthetic
commit/receipt, drift or live submission gates. See
[`P09-high-yield-portals.md`](../plans/P09-high-yield-portals.md) for the
remaining acceptance criteria.
