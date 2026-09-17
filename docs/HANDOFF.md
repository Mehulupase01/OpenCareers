# Handoff

2026-09-17: P00-P04 complete, locally and remotely verified. Existing OpenCareers repository,
branch main. Owner requests commits and pushes at each completed phase.
Read docs/amendments.md for repository, automatic final-click and portal-access scope.

P01 is committed and verified by GitHub run 35061610769 (Windows, Linux, PostgreSQL),
at commit 74b45165fe26dce1c63a02fee761f05cdcf550bc. It includes
configuration, contracts, SQLite/PostgreSQL repositories, queue leasing/recovery,
audit/outbox, a session-protected API, worker and React operations dashboard.
No real candidate data imported and no real applications sent. Final submission,
discovery, inference and packet generation are still pending.

Verified P01 baseline: 37 unit/integration tests across SQLite/PostgreSQL, including
four-process claim races; desktop/mobile browser workflow; typecheck; production
build; public-source scan; dependency audit; isolated install/build/reset/start.
SIGKILL recovery, populated SQLite migration and actual SQLITE_FULL rollback pass.
P02 adds persisted task identity checks, cancellation, uncertain
submission suppression, owner audit attribution, PostgreSQL migration and connection
loss coverage. The connection error is fixed; all 51 tests pass with zero skipped
and no unhandled errors on pinned Node 24.21.0. Typecheck and lint also pass.
P02 CI passed all Windows, Linux and PostgreSQL jobs in run 35062361432 at
9084eb9baa25f87e53c4f54691795e514d203db2. Refreshed desktop/mobile E2E: 2 passed.
See docs/evidence/P02-verification.md for scope and known verification boundaries.

Development services: API 127.0.0.1:4317, UI 127.0.0.1:4318, scheduler. Output is in
ignored .cache/dev.stdout.log and .cache/dev.stderr.log. PostgreSQL test container:
opencareers-postgres-test, loopback port 15437, synthetic disposable data only.
Services were refreshed to P03 on Node 24.21.0; development manager PID 29536.
Revalidate process identities before stopping. API/worker do not hot reload.
Superseded bootstrap files remain in ignored .cache/initial-scaffold.

P03 now implements migration v3, bounded PDF/DOCX import, reviewed fact revisions,
immutable profiles, packet invalidation, scoped/expiring answer memory, standing
authorization/export/revocation, protected API and desktop/mobile candidate UI.
Latest local checks: 79 unit/integration tests passed across both engines with zero
skips; four browser tests passed; typecheck, lint, build, public scan and dependency
audit passed. See docs/evidence/P03-verification.md for gates and limitations.

P03 CI 35162308425 passed Windows, Linux and PostgreSQL at
857047c0b5c885fd3fa96db5d5bfce55b9ad32a3.

P04 implements fixed-origin Greenhouse and Lever public discovery, source leases and
backoff, raw page evidence, normalized vacancies, freshness states, reversible job
identity, historical JSON/CSV imports, protected API/worker integration and a full
desktop/mobile discovery UI. Local checks: 105 unit/integration tests passed across
both engines, six browser tests passed, and lint/typecheck/build/public scan/audit
passed. A read-only live Greenhouse vacancy was normalized and displayed from the
Adyen board on 2026-09-17; see docs/evidence/P04-verification.md. No submit occurred.
P04 CI run 35204726535 passed Windows, Linux and PostgreSQL at
fd9d3364fef509f2ebe3aacc0d67fbf072d5048d. P04 closure commit is 84bd297.

P05 is in progress. The implementation plan is
docs/plans/P05-inference-matching.md: strict zero-price route validation, no tools,
ZDR/data-collection-denied explicit routing, durable daily reservations, bounded 429
backoff, deterministic gates, evidence-bound semantic output, code-owned scoring and
a frozen 50+ case evaluation with holdout reporting. Continue through implementation,
remote CI, phase closure and the remaining phases.

Continue directly after each closure commit.
The owner explicitly requests autonomous continuation; phase checkpoints are updates,
not stopping points. Private documents, real account access and live standing policy
are not configured. Do not label live support or production readiness complete.
The full 18-phase objective remains.
