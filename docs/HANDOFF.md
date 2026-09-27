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

P06 is complete. The exact profile/assessment/policy
packet factory, independent validator, DOCX/PDF extraction and QA, content-addressed
store, migration v6, worker/API and Documents UI are implemented. Local lint,
typecheck, production build, public scan and audit pass. Ten desktop/mobile browser
flows pass against a fresh synthetic workspace, including real PDF.js preview.
GitHub Actions run 36191355705 passed Windows, Ubuntu and PostgreSQL at d1deed7.
The local Docker engine was unavailable, so its 48 tests were verified in CI.
See docs/evidence/P06-verification.md. P07 planning is in
docs/plans/P07-mock-ats-browser-contract.md; implement the owned mock ATS, typed
adapter fill contract, upload/conditional checks and submission-proof dry run.

Continue directly after each closure commit.
The owner explicitly requests autonomous continuation; phase checkpoints are updates,
not stopping points. Private documents, real account access and live standing policy
are not configured. Do not label live support or production readiness complete.
The full 18-phase objective remains.

P07 implementation commit `025eaea` adds the owned mock ATS, isolated Playwright
dry-run context, typed form plans/read-back, server-accepted upload checks,
conditional/challenge handling, migration v7, packet-bound READY persistence and
Documents UI. Local checks: 102 tests passed, 49 PostgreSQL skipped locally;
22 desktop/mobile browser workflows passed from a fresh synthetic reset; lint,
typecheck, build, public scan and production audit passed. P07 CI run
`36194183542` passed Windows, Ubuntu and PostgreSQL. See
`docs/evidence/P07-verification.md`. No employer submission has been made.

P08 engineering gates G1-G5 and G7 are complete. The durable intent, single-use
fenced permit, unattended mock final click, correlated receipts, definitive
rejection, unknown-outcome recovery and read-only reconciliation are implemented.
The provisional Recruitee Careers Site API v1 adapter performs exact-origin GET
preparation and a permit-gated multipart POST with candidate-ID receipt correlation.
No live POST has been made. P08-G6 remains externally pending until a reviewed
private profile, matching standing authorization, appropriate vacancy and private
receipt are available. See `docs/evidence/P08-engineering-verification.md`.

P09 is in progress. Commit `b7f190e` introduces the versioned adapter SDK and
registry, adapter target fingerprint binding, generic API queueing and a worker
with no portal-specific submit/reconcile branches. Commit `9c29659` moves the
existing Chromium install before browser-backed conformance tests. GitHub Actions
run `36307529528` passed Ubuntu, Windows and PostgreSQL. Next: add Recruitee
discovery/coverage reporting and a second compliant real portal family with
sanitized drift fixtures; do not count the owned mock ATS as that second family.

P09 continued through `47a1058`. Recruitee public discovery is implemented;
the Discovery coverage view now ranks the full owner corpus by latest active
profile eligibility and shows each portal tenant's counts. Greenhouse hosted
external forms are the provisional second family. A read-only Chromium
inspector, reviewed-answer planner and GET-only preparation are tested with
synthetic fixtures. A public Adyen form check found 17 controls, one unresolved
mandatory visa/relocation answer, no visible challenge and zero write attempts.
See `docs/sources/P09-greenhouse-hosted-form.md`. Greenhouse fill, final action,
receipt correlation, SDK registration, drift handling and synthetic lifecycle
tests remain. No private profile or live employer submission has been made.
An isolated synthetic-data final-click probe on Adyen intercepted every POST;
only two analytics requests appeared, with no application request or visible
validation error. Do not infer a working final action from that probe. The
read-only preparation write barrier is directly browser-tested in `e9038e7`,
whose CI passed Ubuntu, Windows and PostgreSQL (`36311743031`).
Follow-up after browser hydration with a valid synthetic CV found a hosted S3
upload POST, reCAPTCHA Enterprise reload POST and application POST, all
intercepted. The Adyen page loads reCAPTCHA scripts/iframe before final action;
the inspector now classifies it as `challenge`. Read-only preparation cannot
claim READY from an answer-complete form until upload and receipt handling
exist. This variant needs the scoped P10 challenge handoff, not automated
challenge solving. No employer-facing POST was sent.

P09 planner hardening: mock/Recruitee and provisional Greenhouse preparation
now reject changed caller values for packet-backed identity, CV and related
fields. Exact internal replay retains packet evidence. Focused tests and the
full check passed (121 tests; 55 database-dependent tests skipped locally).
The second-family commit/receipt gates remain open.

P09 coverage now includes a dated variant-level support matrix in the API and
Discovery view, separate from owner-corpus counts. It distinguishes synthetic
mock and Recruitee lifecycle evidence from public-read-only challenged Adyen
Greenhouse and Protolabs Lever forms. The mock dry-run panel now displays
packet-backed phone and portfolio read-only and sends only supplementary
answers. Its synthetic E2E fixture supplies reviewed required identity values;
real missing values need a Candidate update and regenerated packet. Full CI
`36327443129` passed Windows, Ubuntu and PostgreSQL at `b2de20c`. See
`docs/evidence/P09-coverage-verification.md`. P09-G5 reporting is complete;
P09-G2/G6 and private live submission remain open.

P09 drift handling now distinguishes a changed form before a dispatch permit
from a possible employer-facing action. Explicit adapter fingerprint mismatch
aborts the fenced attempt as `BLOCKED_BEFORE_DISPATCH`, leaves that application
`UNSUPPORTED`, and permits a fresh preparation. A post-permit attempt cannot
use this path and remains subject to unknown-outcome reconciliation. The mock
desktop/mobile and Recruitee injected-question tests pass; SQLite integration
tests cover task acknowledgement, lease recovery, intent tampering and the
post-permit refusal. Local `pnpm check` passed (122 tests, 56 skipped). Full CI
is pending. Exact drift details are not yet surfaced in the operations UI.
