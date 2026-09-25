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

P05 is complete. It includes strict zero-price route
validation, no tools or fallbacks, ZDR/data-collection-denied provider pinning,
durable daily reservations, bounded 429 backoff, eight deterministic gates,
profile-bound authorization, exact-span semantic evidence, code-owned scoring and a
responsive Matching workspace. The frozen evaluation has 72 cases and a 12-case
holdout: 20/20 auto-eligible precision, 44/44 hard disqualifiers safely routed, zero
unsupported claims and zero label errors. Local verification passes 129 tests across
SQLite/PostgreSQL and 8 desktop/mobile browser workflows, plus lint, typecheck, build,
public scan and dependency audit. See docs/evidence/P05-verification.md. Authenticated
live free-route reliability is externally pending because no private key is present;
the public catalogue was read only during planning. CI run 35235281544 passed Windows,
Ubuntu and PostgreSQL at 89cff352a9488e57af9d46116b51fbe48507fa25. Proceed with
P06 tailored CVs, letters and answer packets after the P05 closure commit.

P06 planning is decision-complete in docs/plans/P06-document-packets.md. Implement a
single evidence-linked AST, deterministic professional-first generation, independent
claim validation, pinned DOCX/PDF renderers, cross-format extraction equivalence,
content-addressed private artifacts, hash-driven readiness invalidation and a
side-by-side Documents workspace. Use only synthetic golden packets in the repo.

P06 implementation is ready for phase closure. The exact profile/assessment/policy
packet factory, independent validator, DOCX/PDF extraction and QA, content-addressed
store, migration v6, worker/API and Documents UI are implemented. Local lint,
typecheck, production build, public scan and audit pass. Ten desktop/mobile browser
flows pass against a fresh synthetic workspace, including real PDF.js preview.
The local Docker engine was stopped during the final PostgreSQL rerun; the prior
dual-database P06 run passed 144 tests before the last summary-evidence regression
test was added. Re-run all 149 tests with PostgreSQL or use the required CI lane,
then close the ledger and start P07. See docs/evidence/P06-verification.md.

Continue directly after each closure commit.
The owner explicitly requests autonomous continuation; phase checkpoints are updates,
not stopping points. Private documents, real account access and live standing policy
are not configured. Do not label live support or production readiness complete.
The full 18-phase objective remains.
