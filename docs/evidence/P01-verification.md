# P01 Runnable Workspace Verification

2026-09-16. Local acceptance checks passed; remote clean-clone CI is pending the
phase candidate push. This milestone is a runnable foundation, not job submission.

Implemented: demo/local/server configuration validation, shared typed errors,
database-aware health endpoints, owner sessions, Host/Origin checks, bounded login
attempts, a persistent synthetic job list, scheduler heartbeats, queue probes,
processing controls, responsive React views and reproducible production output.
The initial persistence implementation is included because these services use it;
P02 has its own durability and migration acceptance evidence.

## Actual Local Results

| Check | Result |
| --- | --- |
| Pinned Node 24.21.0, SQLite + PostgreSQL suites | 37 passed, 0 skipped |
| Desktop and mobile browser workflows | 2 passed; search, modal/Escape, controls, queue, heartbeat |
| TypeScript strict check | Passed |
| Biome recommended lint and formatting | Passed after correcting migrated preset |
| Production build | Passed, API/worker JS and React assets produced |
| Dependency audit (production) | No known vulnerabilities reported |
| Public source credential-pattern scan | Passed; synthetic screenshots manually inspected |
| Isolated source snapshot installation | Frozen lockfile install passed |
| Isolated snapshot build and production API | Build passed; readiness 200; built HTML/assets served |
| Demo reset in isolated snapshot | Prior synthetic data renamed to a recoverable backup; doctor passed again |

Screenshots are synthetic and contain no owner profile, real job applications or
private receipt data. Development UI is at 127.0.0.1:4318; API at 127.0.0.1:4317.
The isolated verification API used 4321 and was stopped after the check.

## Remaining Evidence

The new GitHub workflow must pass on Windows and Linux from clean checkouts and on
PostgreSQL before P01 is marked complete. No live employer adapter, model gateway,
candidate import, document factory or final-click engine is implemented in P01.
