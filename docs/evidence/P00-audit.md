# P00 Repository Audit

Verified 2026-09-16. Phase P00 is complete; this is an architecture/audit milestone,
not a production-readiness or live-submission claim.

- Existing repository: OpenCareers, current VS Code workspace, branch main.
- Starting HEAD: c6f2d16 (Initial commit); starting worktree was clean.
- Existing files: README.md, .gitattributes, LICENSE. No runtime to reuse.
- Owner-directed repository selection is recorded in docs/amendments.md.
- Git history and the owner's MIT license are preserved.
- Six architecture decisions establish one database authority per profile, typed
  proposals, a dedicated submission boundary, candidate facts and free-only routing.
- R01-R12 map to phases and required evidence in docs/requirements.md.
- All 18 phases and 90 work packages have extracted acceptance gates in the ledger.
- Adapter matrix distinguishes discovery, fill, commit, receipts and reconciliation.
- Public source excludes the private masterplan, CVs, secrets, sessions and receipts.
- Upstream commit and MIT license verified; no upstream code copied.

## Selected Toolchain

| Component | Pin / verification |
| --- | --- |
| Node release target | 24.21.0 LTS; portable execution verified |
| Existing host Node | 24.14.0; development tested |
| pnpm | 12.4.2 |
| TypeScript | 7.0.2 |
| Fastify | 5.12.4 |
| React | 19.3.0 |
| Playwright | 1.63.0 / Chromium 153.0.8010.12 |
| better-sqlite3 | 12.11.1 / embedded SQLite 3.53.2 |
| PostgreSQL test engine | 17.9; image digest recorded in CI |
| Vitest | 5.0.1 |
| Document renderer | Decision deferred to P06 fidelity tests |

All exact direct dependencies are recorded in package.json and the lockfile.
Initial v13 native SQLite package required an unavailable C++ toolchain; v12.11.1
installed its official prebuilt binary and passed the embedded-engine safety check.

## Gate Evidence

P00-G1: requirements.md covers every R01-R12 with verification methods.
P00-G2: architecture.md ADR-001/002/005 establish one authoritative database.
P00-G3: architecture.md and phase ledger place real submission at P08.
P00-G4: Git status, initial file reads and workspace inspection showed no conflicts.
P00-G5: README, .env.example design, architecture, phase ledger and handoff identify
startup, private storage, support claims and resumption state.

Next phase: P01 runnable services and CI. P01/P02 code was developed alongside the
audit but is verified and reported separately. External credentials are unnecessary
for synthetic development. No keys or private candidate records were read.
