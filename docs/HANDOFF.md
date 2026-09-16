# Handoff

2026-09-16: P00 audit and architecture complete. Existing OpenCareers repository,
branch main. Owner requests commits and pushes at each completed phase.
Read docs/amendments.md for repository, automatic final-click and portal-access scope.

P01/P02 implementation is in the working tree and undergoing verification. It includes
configuration, contracts, SQLite/PostgreSQL repositories, queue leasing/recovery,
audit/outbox, a session-protected API, worker and React operations dashboard.
No real candidate data imported and no real applications sent. Final submission,
candidate onboarding, discovery, inference and packet generation are still pending.

Verified locally so far: 31 unit/integration tests across SQLite/PostgreSQL, including
four-process claim races; desktop/mobile browser workflow; typecheck; production
build; public-source scan; dependency audit. Additional SIGKILL, migration and actual
SQLITE_FULL tests were added. A rollback masking issue found by SQLITE_FULL was fixed;
the expanded suite is being rerun on the pinned Node 24.21.0.

Development services: API 127.0.0.1:4317, UI 127.0.0.1:4318, scheduler. Output is in
ignored .cache/dev.stdout.log and .cache/dev.stderr.log. PostgreSQL test container:
opencareers-postgres-test, loopback port 15437, synthetic disposable data only.
Superseded bootstrap files remain in ignored .cache/initial-scaffold.

Next: verify expanded durability tests, finish P01 clean-start/CI verification and P02
gate evidence, then P03 candidate provenance and standing authorization. Do not label
live support or production readiness complete. The full 18-phase objective remains.
