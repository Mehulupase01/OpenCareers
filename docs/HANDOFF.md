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
`36329334882` passed Windows, Ubuntu and PostgreSQL at `a2f755d`. P09-G3/G4
are complete for the registered adapters. Exact drift details are not yet
surfaced in the operations UI.

P09 Greenhouse inspection/fill checkpoint: invisible mandatory controls now
block the provisional variant and affect its fingerprint. A synthetic
challenge-free form is filled under the GET-only barrier with exact-plan
read-back and packet-CV byte verification; page-side value changes, CV
selection failure and attempted writes are tested. The adapter still returns
`unsupported` after a clean fill because upload acceptance and correlated
receipt are unimplemented. Local `pnpm check` passed with 128 tests and 56
PostgreSQL-dependent tests skipped. P09-G1/G2/G6 remain open; no live POST.

OpenRouter private-local setup checkpoint: the ignored `.env` was normalized
without printing its key, and the app now loads a local profile with explicit
free model/provider allowlists; external submission remains disabled. A live
catalogue GET found new pagination metadata, now accepted by the typed parser.
Synthetic-only completion probes proved Nemotron Super strict output and Ultra
prose work technically when privacy filters are removed, but Super returned
HTTP 404 under ZDR plus data-collection denial. NVIDIA trial terms currently
prevent treating real candidate facts as approved input. See
`docs/evidence/P05-openrouter-live-route.md`. Rotate the key exposed in chat.

P09 Greenhouse packet binding checkpoint: preparation and fill now require a
valid packet whose vacancy URL matches the exact board and posting target,
in addition to the existing CV hash and form fingerprint checks. Synthetic
negative tests reject invalid and wrong-posting packets before filling. Local
`pnpm check` passed with 131 tests and 56 PostgreSQL-dependent tests skipped.
Greenhouse remains provisional: accepted upload, final dispatch and receipt
correlation are still unimplemented; P09-G1/G2/G6 remain open.

The owner's DOCX and PDF resumes were imported into the private local source
store on 2026-09-27. They remain `review_required`: no facts, active profile or
standing authorization were created by import. The local UI/API are running
on ports 4318/4317 with external submission disabled. A current free ZDR
ModelRun/Qwen endpoint advertises `structured_outputs`; the policy accepts
that documented capability without requiring an additional catalogue label.
Synthetic-only probes returned 429, so no real candidate inference was sent.
See `docs/evidence/P05-openrouter-live-route.md` for the route limits.

Seventeen exact-source draft facts for skills, languages and education were
created in the private local database. They remain `extracted`, not reviewed;
employment workload, composite identity and visa terms were not inferred.
Matching now withholds work-authorization as well as identity from OpenRouter
and validates proposals against the reduced fact set. Local deterministic
authorization gates remain active. No live candidate request has been sent.

P06 owner amendment is now implemented as an LLM-letter code path, not yet a
live-verified model route. `docs/plans/P06-llm-letter-amendment.md` defines the
contract. A typed proposal selects approved contribution IDs and authors
bounded role-specific prose. The independent packet validator checks the
result, and manifests store model/provider/response hashes. Private worker
preparation waits for a ready free route and uses the shared durable daily
quota; it cannot silently fall back to deterministic letters. The central
submission repository rejects deterministic packets for real external
adapters in private profiles. Synthetic demo packets remain deterministic.
The current `.env` still pins NVIDIA, whose strict ZDR route was unavailable;
the alternative Qwen/ModelRun probe was rate-limited. No real cover letter has
been generated and no external application submitted. Quality evaluation and
live free-route verification remain before this amendment can be called done.
Local verification for this amendment passed 139 tests (57 PostgreSQL-only
skipped), lint, typecheck, build, source scan and dependency audit. See
`docs/evidence/P06-llm-letter-checkpoint.md`; cross-platform CI is pending.

The P06 letter filter follow-up `b6ff6c6` adds a ten-case synthetic adversarial
motivation table. Local check passed 149 tests; previous amendment CI passed
Windows, Ubuntu and PostgreSQL. This is not live LLM quality verification.
The P09 operator drift follow-up now records bounded pre-dispatch drift
categories and shows them in Applications; no candidate text or exception
message is persisted in that field. Its local full check passed 149 tests,
with 57 PostgreSQL-only tests skipped; CI is pending. P08/P09 still need
genuine private receipt and second-family lifecycle respectively.

On 2026-09-28 the owner confirmed employment workloads and Netherlands
work-authorization terms in chat. Three owner-asserted facts were saved only
in the private local database, with month dates read from the imported CV.
No profile or standing submission authorization was published. The private
work-authorization fact has no recruiter-facing approved wording. Matching
now routes explicit no-sponsorship vacancies to review when future sponsorship
is needed; they remain discoverable, since a separately verified payroll
arrangement may be possible. Do not infer such an arrangement or answer a
mandatory application question inaccurately. See the synthetic gate test.

Private onboarding advanced on 2026-09-28: all 17 imported source facts were
reviewed after the owner confirmed the CV, one owner-asserted identity and a
CV-backed Woobblr part-time role were added, and profile revision 1 was
published with 22 facts and no chronology issues. A seven-day review-only
policy covers Netherlands AI/ML roles; it cannot create final-click authority.
Seven public ATS sources (five Recruitee, two Greenhouse) are healthy at
20-minute intervals, with 499 listings read and 448 normalized jobs on the
first private poll. These records and policies remain in ignored local data.
External submission remains disabled.

The ignored local OpenRouter allowlist now pins the only observed free ZDR
structured route, Qwen 3.8 27B at ModelRun, with a daily cap of five. A
synthetic probe still returned provider HTTP 429; no private profile content
was sent. Model-dependent assessments remain paused. Greenhouse read-only
inspection of current DEPT posting 8232711 found a challenge and four visible
unlabeled controls. The runtime inspector now records these as unsupported
instead of crashing; zero writes were attempted. See
`docs/sources/P09-greenhouse-hosted-form.md`.

P09 engineering completed at `9cd7cda`. Greenhouse is registered as the second
common-SDK submission family with exact board/posting/fingerprint binding,
fresh-browser reinspection, one POST after dispatch authorization, typed
receipt evidence and transactional receipt correlation. Synthetic success,
target/form drift, validation rejection and ambiguous-response cases pass.
Public Greenhouse forms are still read-only evidence; no employer write or real
submission occurred. See `docs/evidence/P09-greenhouse-lifecycle.md`.

P10 planning started after P09 closure. The accepted design uses an encrypted
credential vault, one-action signup attempts, hashed one-time handoff tokens and
exclusive browser-generation leases. Human challenge handling can complete only
CAPTCHA/MFA or login steps; final application actions stay blocked until a fresh
automation-owned rebuild. Answer propagation remains exact and evidence-bound.
See `docs/plans/P10-accounts-handoffs.md`.

P10 vault checkpoint: configuration accepts only canonical base64 for a random
32-byte vault key. AES-256-GCM envelopes bind owner, secret ID, purpose and key
version as authenticated data. Migration v9 adds encrypted secrets, employer
accounts, signup attempts and fenced handoff-session storage. The account
repository returns redacted metadata, deduplicates preparation, and releases a
credential only for the exact owner, origin and adapter. At that checkpoint,
signup dispatch and external account creation were not implemented.

P10 signup checkpoint `8b2a40b` implements one-action signup intent, dispatch
permit and correlated receipt handling. Lost responses become unknown and
cannot be replayed into a second account. GitHub Actions run `36457888701`
passed Windows, Ubuntu and PostgreSQL. This is synthetic fixture verification;
no employer account was created.

The P10 handoff foundation checkpoint adds owner-bound challenge persistence. Tokens
are returned once and stored only as hashes; exact preparation/target binding,
exclusive browser leases, generation fencing, expiry replacement and the
submission interlock have SQLite/PostgreSQL integration coverage. The visible
loopback broker and exception UI are still pending, so P10-G3 through P10-G5
remain open. See `docs/evidence/P10-security-checkpoints.md`.

P10 visible-handoff work now adds authenticated create/list/open/complete API
routes and an owned synthetic ATS broker. It launches a dedicated visible
Chromium context, closes it on absolute expiry, verifies that the challenge was
cleared, and rejects completion if an application action was attempted. API and
desktop/mobile Playwright tests cover the full bounded flow; unrelated queue
work remains claimable. External-adapter policies, exception resolution and the
fresh automation rebuild are still pending.

Latest local verification for the visible-handoff checkpoint passed 172 tests
with 67 PostgreSQL-only skips and all 36 desktop/mobile browser workflows, plus
lint, typecheck, production build, public-source scan and dependency audit. The
private local service was restored on the updated code at manager PID `27636`;
API `4317` and UI `4318` are healthy. Revalidate process identities before
stopping it.

The owner supplied the masterplan as a local `.md` on 2026-09-28. It is still
excluded from Git because it embeds a private candidate-policy section. Read
`docs/masterplan-traceability.md` before resuming: it maps R01-R12 and every
Appx.B scenario T01-T32 to the tests that actually assert them. Honest totals
are 15 covered, 11 partial and 6 missing (T23, T24, T26, T27, T28, T32). The
Appendices are not in the repository, so conformance to them was previously
unknown; it is now recorded, not assumed.

Stage 0 groundwork is committed at `497ca21` and `27221e5`. The phase ledger is
migrated to the masterplan Appendix D format at `schemaVersion 2`: tickets are
objects with their own status, evidence and nextAction, the six-value status
vocabulary is in use, P08 is `code_complete_verification_pending` with P08-G6
`blocked_external`, phase P18 records the owner-added portal breadth, and
`scripts/validate-ledger.ts` now runs inside `pnpm check` so the ledger cannot
silently rot again. It found nine real problems on its first run. Decision-
complete plans now exist for P10 closeout and for P11 through P18.
`docs/amendments.md` items 6-12 record the owner's 2026-09-28 scope instructions
and the precedence rule that conversation authority overrides the older
masterplan.

P10 closeout is in progress. Three increments are committed and pushed:
`b9bb03c` adds the employer account HTTP surface and an owned mock-ATS signup
fixture with all five outcomes; `17036b8` allows a challenge handoff on
external portal adapters, replacing the mock-only restriction with a
prepared-URL policy; `5fa7cd5` scopes packet answers to the job and closes
P10-G6. P10-G1 through G10-G6 are complete on named evidence and P10-G7 is not.
Remaining P10 work: the exception inbox, which does not exist in any form and
whose resolution primitive is currently unreachable from any route; the safe
rebuild path with reconciliation-first; and the account-exception mapping for
an expired portal session, which is T32. Next action recorded in the ledger is
`P10-04`.

Two defects worth remembering. Browser tests were running against the owner's
private database: the Playwright web server invoked the dev supervisor, which
loads the private `.env`, and `reuseExistingServer` attached to a running
private instance without complaint. The web server now refuses to reuse a
listener, forces the demo profile with the env file skipped, and a global setup
refuses to run unless the server reports profile `demo`. The handoff broker
browser test also hardcoded an absolute session expiry, so it began failing on
any run after that instant; it now derives timestamps from the clock.

Browser tests require ports 4317 and 4318, so the private local service must be
stopped before running `pnpm test:e2e` and restarted afterwards. The suite is
not hermetic: specs share one demo database and one worker, and repeated full
runs on a freshly reset workspace failed different specs on different runs. The
last full run passed 40 of 40, but per-spec isolation is real outstanding work.

The private local service is running again on the updated code: API `4317` (PID
`5840`) and UI `4318` (PID `16364`), profile `local`, readiness confirmed.
Revalidate process identities before stopping it.

B1 is the next unblocked increment and it is the hardest remaining dependency:
owner amendment 5 requires an LLM-drafted cover letter for any real auto-submit
packet, and the central commit gate rejects deterministic letters for external
adapters. A live catalogue read on 2026-09-28 found 20 free models, 5 with
structured outputs, including `nvidia/nemotron-3-super-120b-a12b:free` at zero
price in both dimensions with `structured_outputs`, while
`nvidia/nemotron-3-ultra-550b-a55b:free` is zero-priced without them. Per-route
zero-data-retention provider eligibility is still unprobed and is the only
remaining hard blocker. The owner must also rotate the OpenRouter key pasted
into chat before any live route work.


P10 is closed and the browser suite is now hermetic. All of this is committed and
pushed: `6aa6355` adds the exception inbox and makes its resolution reachable,
`1bfd961` measures free route zero-data-retention eligibility, `84acb1a` closes
P10-G7, and `48292ba` makes the browser suite hermetic and closes P10 with a
verified commit. The ledger records 72 of 128 gates and ten of nineteen phases
complete. Private local service restored: API `4317` (PID 23420) and UI `4318`
(PID 26324), profile `local`, readiness confirmed.

The exception inbox was the one P10 plan increment whose subject did not exist in
any form. `CandidateRepository.resolveQuestion` was correct but unreachable, so an
ANSWER_UNKNOWN exception could never be created in a running system. Packet
generation now records an exception for every requested answer that answer memory
cannot satisfy, which is what makes the inbox reachable from ordinary operation.
Resolving requires the owner's wording and the facts that support it; a suggestion
appears only when an approved answer already exists for that exact meaning,
employer, country and date; and every decision is a hash-chained append whose
chain is re-verified on read.

P10-G7 closed two real defects. A completed or expired handoff did not unblock
the final action, which was correct, but nothing required the preparation to be
newer than the handoff either, so a form inspected before a challenge could be
submitted after one. The commit gate now refuses any preparation that predates a
settled handoff and names the rebuild as the safe action. Separately,
`BrowserRepository.save` refused nothing about prior attempts, so a form could be
rebuilt while an earlier commit was still ambiguous; it now refuses outright.

The browser suite was not hermetic and this was a genuine defect, not just
flakiness: different specs failed on different runs, and documents.spec.ts failed
when run alone because it inherited its corpus from whichever spec ran first.
tests/helpers/browser-setup.ts now guarantees the corpus and the profile
explicitly, and the suite passes 42 of 42 twice consecutively from a fresh reset
with documents passing in isolation.

Free route availability was measured rather than assumed, using the owner's
rotated key read through the application configuration and never printed. Every
probe carried one synthetic sentence and no candidate content. Of the 20 free
models, 3 are zero-data-retention eligible and 4 advertise structured outputs, and
those two sets are disjoint. All NVIDIA free routes return 404 for zero data
retention, which settles the earlier 404 as a provider property. The previously
pinned qwen3.8-27b:free has been retired from the free tier, so the earlier 429s
were that and not rate limiting. Owner amendment 5, which rejects a deterministic
letter for a real auto-submit packet, is therefore satisfiable only by having
code select the approved contribution IDs deterministically while the model
authors prose; that path is the next increment and needs an owner decision on
letter quality for small flash-class models versus enabling a ZDR-capable
provider on the OpenRouter account.

Known tracked advisories: four moderate transitive advisories in fast-uri and
fastify, published after the last supply-chain pass, are recorded with a
reachability analysis in docs/evidence/P10-closeout-checkpoint.md and belong to
P15-04.

The next unblocked increments are the B1 letter path, the P18-01 owner-account
session vault, and the account session exception mapping tracked as Appx.B
scenario T32. Browser tests still require ports 4317 and 4318, so the private
service must be stopped before running `pnpm test:e2e` and restarted afterwards.

## 2026-10-09: Production Completion Resumed

The owner approved the full completion plan with token-efficient execution; all
P00-P18 scope remains. Read `docs/plans/PRODUCTION-COMPLETION.md` for execution order.
Baseline recovery fixes Windows artifact-root aliases while rejecting redirected
artifact/hash directories, installs Chromium in PostgreSQL CI, and patches all
four known moderate dependency advisories. The private masterplan is untracked
but preserved locally; its published history is not purged. Public scanning now
rejects unreviewed documents and pins four reviewed synthetic goldens by hash.

The old port instruction immediately above is superseded: browser tests now use
14317/14318, never stop or reuse the private 4317/4318 service, and retain forced
demo and readiness checks. Full check passed (236 tests, 82 PostgreSQL skips),
42 browser cases passed, public scan passed, production audit reported no known
vulnerabilities. A further golden-integrity regression passed separately. See
`docs/evidence/BASELINE-RECOVERY.md`; post-push CI is recorded subsequently.

Next: repair exception approval/reconciliation/rebuild and consume durable inspect
tasks. No real application has been sent and no private database has been reset,
migrated or republished. Existing closed phases are historical labels, not authority
to ignore defects; reopen affected gates when recording the corrective work.

## 2026-10-09: Workflow Recovery Checkpoint

Baseline commit 058b79b passed GitHub run 37852286732 on Windows, Ubuntu and
PostgreSQL. The next repair checkpoint centralizes immutable scoped approval,
fixes reconciliation/retry/rebuild tasks, consumes durable inspection work,
renews task leases, prevents stale inspection from overwriting owner readiness,
and tightens handoff writes/resources/navigation/lease expiry. Read
`docs/evidence/WORKFLOW-RECOVERY.md` for delivered behavior and remaining limits.

P10 is deliberately reopened: G3/G6/G7 and tickets 03/05 still require solved
session continuation, complete exact-answer gates and all affected-form resumption.
The ledger now has nine completed phases and 69/128 completed gates; this is a
correction of overstated previous closure, not removed product scope. P08 still
requires a real receipt, and P11-P18 remain open. No real employer action occurred.

Full local check passed: 253 tests, 89 PostgreSQL skips, 38 files, build/typecheck/
lint/ledger. Test storage is independent per run and desktop/mobile viewport;
ports are 14317/14318 and 14319/14320. Previous shared-state failures exposed a
stale-result race plus valid duplicate-history refusal; neither guard was weakened.
Synthetic owner answers are approved explicitly before the browser final-click test.
Private services and ordinary demo data stay untouched by the new harness.
Final isolated browser run passed all 42 cases in 2.2 minutes. Workflow commit
03c25c4 passed all three lanes in GitHub run 37855268175.

Next: finish actionable parked exceptions and affected-application resumption;
encrypt session/document storage and implement restore blocking; then explicitly
implement the owner-approved reviewed-provider privacy revision for LLM letters.
Mailbox provider and OpenRouter key rotation were requested in chat without pausing
unrelated work. Do not use a key previously pasted in chat for live inference.
The old P11 plan's migration numbers and line references are historical; append
to the actual current schema rather than adopting its obsolete v10 assumption.

## 2026-10-09: Encryption and Restore Checkpoint

Private document/source writes are now authenticated ciphertext, with the same
plaintext hashes/manifests and verified plaintext downloads. Missing keys and
legacy files fail closed without falsely invalidating packets. The explicit
`documents:encrypt` command is offline, preflighted, resumable and leaves processing
stopped; it has not been run against private data. Existing files are not silently
rewritten. Read `docs/evidence/ENCRYPTION-RESTORE.md` for the exact operator boundary.

The new restore checksum startup marker persists a durable barrier before workers
or the API can run. Old tasks/handoffs/forms/packets are retired; uncertain attempts
remain UNKNOWN with original reconciliation payloads. All restored applications,
even pre-intent ones, need owner review. Quarantine persists at claim/intent/dispatch
after the general barrier is released. Only an existing validated confirmed receipt
can settle a quarantine; no "assume unsent" or normal-control bypass exists.

P15 recovery/supply-chain work is in progress, not complete. P10 is still open;
whole-database encryption, complete backup/restore tools, signup/mailbox fencing,
solved-session continuation, automatic restore detection and real soaks remain.
Full check passed (274 tests, 94 PostgreSQL skips, 41 files), as did all 42 isolated
desktop/mobile browser cases in 2.8 minutes. Lint/typecheck/build/ledger, public scan
and production audit passed. GitHub run 37857873687 passed Windows, Ubuntu and
PostgreSQL at f93254420f5954fee4b4c1fef95017800bb0ad06; no live support is claimed.

Owner answered the pending chat questions: Gmail is the mailbox provider and the
previously exposed OpenRouter key has been rotated in the local .env. Gmail OAuth
desktop-app credentials are already saved locally; their path is not yet supplied.
Never print the key. Next inference work must explicitly implement the earlier approved
reviewed-provider/minimized-facts privacy amendment; strict routing is still active.

## 2026-10-09: Actionable Inbox and Scoped Resumption

Parked applications now get persistent exception IDs instead of unresolvable
synthetic IDs. Action availability is derived from current questions, assessment,
challenge preparation, handoff, attempt and restore state, then rechecked under
the owner lock. Non-application dead-letter tasks remain visible and deferrable.
Skip revokes stale work and handoffs, advances the application revision, settles
sibling blockers and cannot conceal a possible employer dispatch.

Candidate and exception approval now share affected-application resumption.
Every equivalent in-scope application can resume once its known questions are
resolved and an active-profile assessment exists. Other wordings/employers,
unresolved questions, terminal applications and restore/dispatch uncertainty
remain excluded. Fresh preparation retires old forms and handoffs. Owner answer
propagation is recorded in the decision history; candidate UI scope controls and
all-adapter form-value validation remain open.

Reconciliation resolves the original task through its checksum-verified intent,
not its now-revoked task fence. It validates owner/application/adapter/packet/form
bindings and can only enqueue read-only reconciliation. Challenge-session creation
and exception completion are one transaction, with owner attribution and expiry.
See `docs/evidence/INBOX-RESUMPTION.md` for verification and remaining gates.

Full check passed (281 tests, 101 PostgreSQL skips, 41 files), as did all 44 isolated
desktop/mobile browser cases in 2.4 minutes. Public-source scan and production
audit passed. GitHub run 37859677291 passed Windows, Ubuntu and PostgreSQL at
477d02d649cb5279fd7ec27db651e83508824f92; no live adapter support is claimed.

P10 and P15 remain in progress: no additional phase is claimed complete. Gmail
credentials exist locally; their path was requested in chat, never their contents.
No real employer action, private migration, key change or service restart occurred.
