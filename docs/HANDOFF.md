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

## 2026-10-09: P10 Verified Closeout

P10 is complete against owned fixtures after canonical answer validation before
fill and transactional dispatch, encrypted owner-bound ordinary-cookie recovery,
generation/expiry fencing, fresh-browser inspection and receipt-backed mock commit.
Details and exclusions: `docs/evidence/P10-verified-recovery.md`.

GitHub run 37864831023 passed Windows, Ubuntu and PostgreSQL at
50ad0608b9d7c89e4c4a48b0b4d55d5561e01a1d: 41 unit/integration files on each OS,
19 integration files in the PostgreSQL lane, and all 44 browser cases on each OS.
Lint, typecheck, public scan, build and production audit passed. The ledger records
10/19 phases and 72/128 gates complete. Production authentication-cookie allowlists
remain empty; fixture evidence is not live ATS certification. Private services,
data and keys were untouched. P08 live receipts and P11-P18 release work stay open.

Next is execution-order step 4: the explicit owner-approved reviewed-provider
privacy revision for minimized OpenRouter matching and mandatory LLM letters.
Public catalogue review found Nemotron Ultra lacks advertised structured outputs;
NVIDIA's linked trial terms restrict production and personal-data use. Do not
silently waive those constraints. Novita currently serves a structured-output free
route; recheck endpoint availability and pin reviewed terms before activation.

## 2026-10-09: Reviewed Inference Revision

Execution-order step 4 now has an explicit, expiring Novita-only privacy revision
for minimized matching and mandatory LLM letters. Both builders share controls;
the transport refuses weaker or altered controls before HTTP. Endpoint-level free
pricing/capabilities, zero-price ceilings, stale-route invalidation, privacy-hash
audit and durable quotas remain enforced. Read `docs/evidence/REVIEWED-INFERENCE.md`
for reviewed terms, exact nonsecret configuration and disclosure limitations.

No private `.env`, process, migration, key or inference call was changed. Strict
privacy remains the default. This implements the approved amendment, not another
phase closure; model quality and a live activation/application remain unverified.
Next: P11 Gmail integration with minimal read-only correlation and encrypted OAuth;
desktop credentials exist but their path is still pending in chat.

## 2026-10-10: P11 Gmail Implementation In Progress

Reviewed-inference commit 5675ea9f605e12cf632c3cc1ef5bd0c86b8dd54b passed
Windows, Ubuntu and PostgreSQL CI 37866247964 (44 browser cases on each OS).

Gmail now has encrypted owner/client/mailbox-bound desktop OAuth, read-only
bounded acquisition, conservative correlation, duplicate-safe outcome events,
an authenticated Mailbox workspace and private worker polling. Strong stored
email receipts queue only the original read-only reconciliation; the existing
submission authority confirms unknown attempts without a second final action.
Read `docs/evidence/P11-gmail-foundation.md` for implementation and limitations.

P11 remains in progress; no gate or phase was prematurely closed. Next: durable
pagination/context cursors, validated verification-link flows, the complete
OAuth failure matrix and nonblocking worker polling. The credentials path and
real owner consent are still pending. No private file, service, key, database or
real application was touched. Migration 13 ran only against synthetic test stores.

Local milestone checks: 330 tests passed (124 PostgreSQL tests skipped locally),
46 desktop/mobile browser workflows passed, plus lint/typecheck/build/ledger,
274-file public scan and production dependency audit. Existing helper-any lint
and bundle-size warnings remain. CI evidence must be checked against this milestone.

Receipt timing review also covers mail arriving during a stale read-only
reconciliation. Duplicate ingestion now requeues only the same latest unknown
attempt after the earlier task finishes, without duplicating the outcome event.
The documents integration fixture explicitly exercises this interleaving.

## 2026-10-10: P11 Recovery And Reviewed Verification

Durable encrypted page checkpoints, fair context rotation and full-set correlation
are implemented. Invalid scans pause without revoking OAuth; owner reset fences old
readers. Private Gmail sync now runs outside the worker's task-claiming loop.
Migration 14 adds reviewed verification routes and hashed success evidence. Only
uniquely correlated pending signups create encrypted link proposals; exact reviewed
GET destinations and redirect chains are rechecked against current policy. Unknown
GET outcomes cannot replay or be bypassed with a second token for that account.
The Mailbox surface exposes approvals and redacted status, never URL tokens.

All 46 desktop/mobile E2E cases passed and the mobile mailbox screenshot was
inspected. Public scan passed 280 files; dependency audit is clean. The frozen local
suite passed 374 tests (136 PostgreSQL skips), lint/typecheck/ledger and build.
Commit `14412f2c394cb56d36a2d1b20d2c65a4c0d3abf0` passed Windows, Ubuntu and
PostgreSQL CI 38085606256. P11's seven fixture-proven gates are complete:
11/19 phases and 79/128 gates complete. Live Gmail remains externally blocked by missing credentials path and
owner consent; no private services, real credentials or employers were touched.
Next engineering work follows `docs/plans/PRODUCTION-COMPLETION.md`: P08 live
receipt needs actual authority and access, and P18 LinkedIn/Indeed source breadth
comes before P12 optimization. Do not wait on live prerequisites to develop owned
fixtures. P12 remains a fixed bounded preparation graph, never submission authority.
Follow the current privacy amendment, not the older plan's strict-only wording.

Fresh synthetic preview: http://127.0.0.1:14324 (API 14323), hidden development
manager PID 9980; logs `.cache/p11-preview.stdout.log` and `.cache/p11-preview.stderr.log`.
It skips `.env`, uses a fresh demo run ID and cannot submit externally. Private
4317/4318 services were not restarted. API/worker changes require a fresh preview.

## 2026-10-10: P18 Owner-Source Session Foundation

P11 closure commit `a4437a352fe4dbbf4cd25e1051bcebc5a9d5721c` also passed all
three CI lanes in run 38086015851. P18 is now in progress, not closed. Migration
15 and the scoped encrypted source-session repository, authenticated metadata/
import/revoke routes and Discovery controls are implemented. No network adapter
is activated by storing a session. Cookie-only exact-host state is deliberately
bounded and rejects challenge material; generic localStorage/capture and reviewed
ingestion are still pending. See `docs/evidence/P18-source-session-foundation.md`.

Focused checks: 28 passed, 12 PostgreSQL skipped before the added restore test;
both desktop/mobile Discovery cases passed and the mobile Sources screenshot was
inspected. Frozen full check: 388 passed, 149 PostgreSQL skipped, 47 files; lint,
typecheck, ledger and build passed. Public scan: 285 files. Cross-platform CI is
pending for this increment. The fresh demo manager is now PID 21064 on the same
14323/14324 ports, after checking the old preview's process tree and listeners.
Only that owned synthetic preview was replaced; private 4317/4318 were untouched.
The LinkedIn/Indeed permission review is documented, not replaced by an assumption
that a logged-in account grants automated access. No real accounts were touched.

## 2026-10-10: P18 Ashby Discovery

Owner-source commit `904a77238f46deea753d9cdb16fce2c5a254c58f` passed Windows,
Ubuntu and PostgreSQL CI 38086701394. Ashby public discovery now shares the source
leases, complete-snapshot validation, dated raw evidence and identity pipeline.
Public read normalized 68 postings; its retained response hash and isolated probe
database are recorded in `docs/evidence/P18-ashby-discovery.md`. This is discovery
only: application operations remain planned and no Ashby submission adapter exists.
Sources now default to the requested 20-minute interval; saved private sources were
not changed. P18-G4 remains in progress because the other five families are pending.

Full local check: 397 passed, 150 PostgreSQL skipped, 49 files; build/lint/typecheck/
ledger passed. The final synthetic fixture label changed afterward and its focused
Ashby tests passed (9 passed, 1 PostgreSQL skipped). Public scan: 288 files. All
48 desktop/mobile browser cases passed and the Ashby mobile screenshot was
inspected; final typecheck passed after the source-default adjustment. The vacancy identity test now selects
explicit employers/postings, not positions that depend on the number of sources.
No private service, credential, candidate data or employer application was touched.

## 2026-10-10: P18 Personio Discovery

Ashby commit `69d429151dffc2e366ab073962be9846956663ef` passed Windows, Ubuntu
and PostgreSQL CI 38087448146. Personio enabled XML discovery now uses the same
leases, complete snapshots, dated evidence and identity pipeline. Public Personio
read yielded 1 posting; raw response and normalized listings are retained in an
isolated ignored probe database, with hash/date in
`docs/evidence/P18-personio-discovery.md`. XML has strict root/schema/nesting and
DTD/entity-declaration guards. Disabled feeds and rate limits fail closed.
Global/EU select com/de explicitly. Publication dates and secondary-office coverage
are not inferred. Application operations remain planned, no submission adapter.

Full local check: 417 passed, 152 PostgreSQL skipped, 51 files; lint/typecheck/
ledger/build passed. All 50 desktop/mobile browser cases passed; Personio mobile
screenshot inspected. Public scan: 293 files. Cross-platform CI is pending for
this increment. Synthetic preview refreshed after owned process-tree/listener
checks: manager PID 5912, API 14323, UI http://127.0.0.1:14324. No private service,
credential, candidate data or real employer application was touched.

P18 remains open; 11/19 phases, 79/128 gates complete. Next public families:
SmartRecruiters, Teamtailor, Workable, Breezy. SmartRecruiters official Posting API
lists public summaries with offset/limit and requires separate posting GETs for
descriptions; explicit PUBLIC-only destination and fixed company/detail origins
must be enforced. Do not treat summary-only discovery or a partial timed-out
scan as a complete board. Universal hosted forms, reviewed owner ingestion,
20-source operational coverage and five gated families are still required.
Real Gmail credential path/consent and P08 genuine private receipt remain external.

## 2026-10-10: P18 SmartRecruiters Discovery

Personio commit `bab3d5d9226f834eb394614f3bc8c4975a8e9cc7` passed Windows,
Ubuntu and PostgreSQL CI 38088022749. SmartRecruiters public list/detail discovery
is implemented, with explicit PUBLIC destination, fixed company URLs and exact
posting identity checks. A dated public Sana Commerce scan normalized six jobs
with descriptions, retaining seven raw responses and hashes in an isolated probe
database; see `docs/evidence/P18-smartrecruiters-discovery.md`. The documented
sample company had zero listings and is not counted as a normalized-job sample.

Focused regressions: 51 passed, 12 PostgreSQL skipped across six files. Lint,
typecheck, ledger and production build passed; public scan 297 files. All eight
desktop/mobile Discovery cases passed and mobile screenshot inspected. Complete
CI is pending after push. The earlier Personio full check passed 417 tests and
50 browser cases; do not attribute that older full-suite result to this increment.
No private service, candidate, credential or employer application was touched.

P18-G4 remains in progress. SmartRecruiters has a 200-request/60-second bound,
not resumable large-board support; incomplete scans never replace the prior
snapshot. Next documented public routes: Workable's published
`www.workable.com/api/accounts/{tenant}?details=true` (the `workable` sample tenant
returned 404; no successful sample claimed), and Teamtailor `jobs.rss` with
offset/per_page pagination. Teamtailor RSS defaults to only 100 jobs, so one page
is not complete. Breezy access route still needs primary-source review.

## 2026-10-10: P18 Workable Discovery

SmartRecruiters commit `926d0e7fe11807f469deccba446a5ff3816c5942` passed Windows,
Ubuntu and PostgreSQL CI 38088398806. Workable published account discovery is now
implemented. The documented www account route redirects to the exact same-tenant
public widget route; only that single redirect is admitted and both responses
retain dated evidence. A public Workable `careers` read yielded two jobs with full
descriptions. Raw responses/hash/date/probe DB are recorded in
`docs/evidence/P18-workable-discovery.md`. Hidden locations remain unknown and only
the primary visible location is normalized. Application operations remain planned.

Full local check: 452 passed, 155 PostgreSQL skipped, 55 files; lint/typecheck/
ledger/build passed. All ten desktop/mobile Discovery cases passed, including all
four added families and the existing history/identity workflow together. Mobile
screenshot inspected; public scan 301 files. Cross-platform CI is pending for the
Workable checkpoint. Earlier complete browser runs: Personio 50, SmartRecruiters
52 in CI; do not attribute those older full runs to Workable.

The owned synthetic preview was refreshed after process-tree/listener checks,
manager PID 3768, API 14323, UI http://127.0.0.1:14324; ready endpoint reports demo.
No private service, credential, candidate data or employer application was touched.
11/19 phases and 79/128 gates remain complete, P18-G4 in progress with four of six
new public-feed families. Next: Teamtailor RSS, then Breezy after primary access
review. A credential-free public-DNS-pinned read of
`https://career.teamtailor.com/jobs.rss?offset=0&per_page=100` yielded 13 items, with
title/description/pubDate/link/remoteStatus/guid and `tt:locations.tt:location`
metadata. This inspection was not retained as a normalized connector sample;
the actual connector must parse/retain it and traverse offset/per_page to a short
page, detect duplicates/drift, and never assume the default first 100 is complete.
Custom-domain feeds, universal forms, reviewed owner ingestion, 20-source
operational coverage, five gated families, P12-P17, real Gmail path/consent and
the P08 private live receipt remain outstanding.

## 2026-10-10: P18 Teamtailor Discovery

Workable commit `a4389c694dea22deab76efc278a47c46ed68492f` is in CI 38088890531;
Ubuntu and PostgreSQL passed, Windows browser checks were still running at this
checkpoint. Teamtailor tenant RSS discovery is implemented with offset/per_page
pagination through a short terminal page. Typed XML, exact channel/job tenant
checks and duplicate detection fail closed. A public Teamtailor `career` feed
normalized 13 jobs, retaining raw response/hash/date in an isolated probe DB;
see `docs/evidence/P18-teamtailor-discovery.md`. Custom domains and secondary
locations are not supported; application operations remain planned.

Focused regressions: 44 passed, 11 PostgreSQL skipped, six files. Typecheck, lint,
ledger and production build passed; public scan 305 files. All twelve desktop/
mobile Discovery cases passed with the five new source families and existing
history/identity workflow together; mobile screenshot inspected. Complete CI
follows the push. The earlier Workable full local run was 452 passed, 155 skipped
across 55 files; do not attribute it to this newer increment.

Five of six P18 public-feed families are now implemented with normalized dated
reads. Breezy remains: its public Codebase portal and referenced official CDN
index.js were inspected credential-free and DNS-pinned, but no documented complete
description-inclusive public feed has yet been established. Do not use its
authenticated employer API or label HTML inspection as a connector. The published
portal-widget documentation is `https://help.breezy.hr/en/articles/5307157-customizing-your-career-portal`.
P18 stays open, 11/19 phases and 79/128 gates complete. Universal hosted forms,
reviewed owner ingestion, 20-source operational coverage and five gated adapter
families are still required. No private account, service, candidate data,
credential or real employer submission was touched.

## 2026-10-11: Public Discovery Milestone

Owner approved larger workflow batches and dependency-safe P12/P13 engineering
without waiting for all P18 breadth. See the sequencing amendment in the
production-completion plan. Breezy public discovery is implemented: typed
tenant list, inert JobPosting JSON-LD descriptions, exact identity checks,
bounded requests and final list consistency reread. Seven actual public jobs
and nine hashed responses are retained in an isolated ignored probe database;
see `docs/evidence/P18-breezy-discovery.md`. Its public publishing route is
observed, not a documented stable employer API. No credentials or writes.

Frozen full local check: 483 passed, 157 PostgreSQL skipped, 58 files; lint,
types, ledger and build passed. All 14 desktop/mobile Discovery browser cases
passed; mobile screenshot inspected; public scan passed 308 files. Existing
lint any/chunk-size warnings remain. P18-G4 and P18-04 close: all six planned
public families have readers and dated normalized/raw evidence. P18 itself
stays open. Counts now 11/19 phases and 80/128 gates; session consumption,
resumable large scans, shared forms, 20-source operational coverage and gated
adapters remain. Next: shared low-risk form inspection/fill primitives, then
P12/P13 alongside P18 breadth. Genuine P08 receipt and Gmail owner consent
remain external verification prerequisites. Private installations untouched.

## 2026-10-11: Shared Form Core Milestone

Public discovery milestone pushed as `015017c9f2cd0e2c803b56ee8053591493ac1ddf`.
CI 38094756123 Ubuntu and PostgreSQL passed; Windows first attempt failed with
Chromium ERR_NO_BUFFER_SPACE in the unchanged adapter-sdk mock navigation, not
a Breezy assertion. Only the failed lane was rerun; result pending at this entry.

Shared hosted-form core recognizes only labelled, native, low-risk name/email/
phone/portfolio controls. It pins vacancy identity and structure, revalidates
packet-backed plans and canonical guards, blocks all network during generic
fill, and performs final readback/native validation. Unknown controls stop the
whole preparation; no generic clicks, uploads, graph authority or submissions.
Greenhouse shares native fill/readback and read-only routing while preserving
its own upload, packet, approval and dispatch safeguards.

Verification: full frozen local check 497 passed/157 PostgreSQL skipped across
59 files; all 58 desktop/mobile browser cases passed. Last generic-only native
constraint hardening passed 26 targeted tests and typecheck. See
`docs/evidence/P18-shared-form-core.md`; no full-local 499 claim. Public scan
311 files and dependency audit passed before the new evidence document.
P18-G2/P18-02 move to in_progress, not complete: owner-policy/API/persisted
preparation/exception UI integration remains. No new submission adapter is
enabled. Counts remain 11/19 phases, 80/128 gates. Source-session consumption,
resumable large scans, 20-source operational coverage, five gated families and
P12-P17 remain. No private profile, key, CV, OAuth grant or real application used.

## 2026-10-11: P12 Preparation Foundations

Both preceding milestone CI runs are green: 38094756123 (failed Windows lane
rerun) and 38095275316. P12 now has fixed typed contracts, migration 16,
owner-isolated checkpoints, bounded pure graph/batch execution and task-class
allocations in the existing inference ledger. Mandatory letters are charged
to drafting, not triage. Production transports revalidate current free prices
and reviewed endpoint evidence for every completion; no policy means no call.
Actual killed-worker recovery preserves an existing UNKNOWN attempt.

See `docs/evidence/P12-preparation-foundations.md`: full check 531 passed /
165 PostgreSQL skipped across 64 files; final focused checks
74 passed / 18 skipped. P12 stays open, no graph/batch production registration
or live quality claim. Next: actual minimized node/packet integration, bounded
critic/repair, measured routing, held-out ablation and retention. Counts remain
11/19 phases, 80/128 gates until CI-backed gate evidence is recorded. Private
services and secrets untouched. No overnight follow-up was created: host
automation tooling was unavailable; do not assume coding continues after the
active session ends. Owned synthetic preview remains at 127.0.0.1:14324.

## 2026-10-11: P12 Gateway And Reviewed Letter Workflow

Implemented a reviewed-fact/minimized pure node gateway, allocation-backed
critic/repair and cancellation through catalogue, endpoint and POST requests.
`LetterDraftRunner.draftWithCritique` performs bounded draft/critique/one repair
and independent packet validation; valid synthetic results render five local
artifacts through the existing factory. Normal mandatory LLM drafting remains
the worker default; graph/review variants remain disabled pending evaluation.
See `docs/evidence/P12-letter-review.md` for tests and limits. Frozen code checks:
546 passed / 179 PostgreSQL skipped, 66 files; focused workflow: 29 / 11 skipped.

Foundation CI 38097596542 passed PostgreSQL and all code checks, but both browser
lanes failed matching quota expectations (56/58 passed each). New triage caps
were genuinely exhausted; tests now verify exact deferral evidence and keep
the successful path. Listing fixture waits for an already-started poll instead
of bypassing its cadence rule. Successor full browser/CI results still need
recording. No P12 phase or gate is falsely closed. Remaining P12: measured
task routing, ablation and production orchestration integration. Subsequent
verification passes all 58 desktop/mobile browser cases. It exposed and fixed
background matching ignoring preparation pause; regression tests also cover
emergency stop and restore quarantine. Graph storage now caps six active runs,
expires abandoned work, and retains 1,000 terminal runs and 1,000 checkpoints.
Final frozen code verification passed; successor CI evidence still needs recording.

## 2026-10-11: P12 Routing And Ablation

Successor CI 38098680540 at `1f1ea9c264fc3c3e6309c212ba2643b63ab7a8ab`
passed Windows, Ubuntu and PostgreSQL, including all 58 browser cases per lane.
P12 checkpoint ticket and gates G2/G3/G4/G6 now close on that verified code.
Counts: 11/19 phases, 84/128 gates. P12 remains open.

Migration 17 adds atomic, bounded owner/task-scoped route observations. Matching
catalogue refresh ranks eligible free/privacy-compatible candidates only when
all have sufficient observations; otherwise owner order remains. Three recent
failures suspend a candidate. Matching validates claims before successful ledger
completion, so unsupported evidence cannot improve ranking. This acceptance
metric is not human-labelled semantic accuracy. Other task classes record
observations but do not yet automatically select task-specific routes.

Conservative byte-based context/token admission now runs before node quota
reservation and before reviewed-letter calls. It is not an exact tokenizer or
an upstream billing guarantee. Batch quota/route exhaustion defers after one
dispatch, without retry amplification. See `docs/evidence/P12-routing-ablation.md`.

Held-out synthetic ablation: 12 jobs, zero routing errors, three eligible packets.
All three variants had zero claim errors/corrections; critique required two
requests per accepted packet versus one for normal drafting. No improvement is
established, so the graph/review variant stays default-off. Real applications
still require LLM-generated letters. Full local suite: 558 passed, 181 PostgreSQL
skipped, 67 files; subsequent matching regression: 11 passed/11 skipped. Build,
typecheck and ledger passed; public scan 334 files; production audit clean.
Milestone CI for these new changes remains pending until push. Private services,
secrets, CVs and authorizations were untouched; no real applications were sent.

Next: complete P12 worker/task integration without granting agents submission
authority, then independent Windows runtime engineering alongside P18 coverage.
Genuine receipts, Gmail consent and real 24/72-hour soaks remain unfinished.

## 2026-10-11: P12 Integrated Workflow And P13 Runtime

Routing/ablation commit `ec192530569cbc4e8e9b114743589b56d18cdca5` is green
in CI 38100030249 (Windows, Ubuntu, PostgreSQL). Its verified bounds and
default-off decision close P12-G1/G5; all six P12 gates now have evidence.
Counts: 11/19 phases, 86/128 gates. P12 is code-complete/verification-pending
until the newer workflow ticket evidence passes milestone CI, not yet complete.

See `docs/evidence/P12-workflow-integration.md`. The real batch dispatcher now
shares the production transport/ledger, minimized evidence, isolated identities,
bounded splitting and non-amplifying deferral. Task-class routing is persisted
in the existing inference state and wired into worker letters. The tested worker
letter boundary requires LLM drafting privately; optional bounded critique is
selected only with `AUTOPILOT_LETTER_REVIEW=true`. Default is false, and generic
graph/batch auto-dispatch remains off under the measured no-improvement decision.
There is no template fallback for a failed private LLM call and no agent authority.

P13 runtime engineering proceeds independently under the approved sequencing.
The compiled launcher supervises API/worker, checks current-generation readiness,
caps restart/backoff, drains through IPC and controls locally with an independent
nonce. The actual application outlives its detached launcher, refuses duplicate
start/unauthenticated stop, recovers after its scheduler is killed and stops
cleanly. Future/corrupt config is refused. Explicit private config avoids the
repository env. Metadata/error-code logs are bounded and do not retain raw child
output. Windows startup requires explicit approval and was dry-run only; no
scheduled task or private installation was changed. See
`docs/evidence/P13-runtime-foundation.md` and `docs/WINDOWS-RUNTIME.md`.

Frozen full check: 577 passed / 189 PostgreSQL skipped, 70 files; lint, types,
ledger and build passed. All 58 desktop/mobile browser cases passed. Final
generation-handshake and diagnostic-code hardening passed 22 targeted tests
(seven lifecycle, 15 API). Do not claim a full-local 578 result. Public scan
349 files and production audit clean before this handoff addition; final scan
and successor CI still need recording. Existing lint/chunk-size warnings remain.

No live inference or real applications were sent, and private services/DBs,
CVs, keys, OAuth grants and standing policies were untouched. P13 still requires
actual approved startup, packaging, scheduling, operations/capacity evidence,
real 24-hour soak and genuine receipt-backed ramp. P14-P17 and P18 source-session
consumption, resumable large polls, operational 20-source breadth and policy-bound
shared-form/adapters remain. No overnight Codex continuation was created.

## 2026-10-11: Resumable Discovery Milestone

Windows CI exposed a real verification issue: the installer dry run timed out
after ten seconds before PowerShell produced output. `b799433` added structured
synthetic failure diagnostics; `370e584` moved the approval guard before private
configuration loading and allowed a bounded 45-second cold process startup.
All seven Windows lifecycle tests passed in run 38131370706. That run passed
Ubuntu and PostgreSQL but initially failed one mock-ATS browser unit case with
Chromium `ERR_NO_BUFFER_SPACE`. Only the failed Windows lane was rerun; its
result must be checked before closing P12. Prior runs 38102016001 and 38102627473
failed the installer test and do not count as successful milestone evidence.

Migration 18 and the production discovery worker now checkpoint bounded public
GET slices, reconstruct after SIGKILL, revalidate cached responses, preserve
dated evidence and publish only complete scans. Same authoritative database,
parsers and guarded ingest; no separate automation stack. See
`docs/evidence/P18-resumable-public-scans.md` for storage/time ceilings, drift,
backoff, permission boundaries and the five-minute consistency window.

Frozen full local check: 588 passed / 199 PostgreSQL skipped, 72 files; lint,
types, ledger and build passed. All 58 desktop/mobile browser cases passed.
Final transport-spacing/coverage regression: 11 passed / 11 skipped. Subsequent
worker-entry-point regression: 10 passed / 10 skipped, including 500 jobs through
neutral scan deferral and one completed ingest. Do not claim a full-local 589
result. Public scan 356 files before final documentation; dependency audit clean.
The new discovery milestone needs its own remote CI after push.

Counts remain 11/19 phases and 86/128 gates until evidence-backed closure.
P18 is not complete: logged-in permission-bound session consumption, operational
20-source coverage, policy/API-bound hosted forms and remaining portal families
are still open. No real inference, employer submission, Gmail consent, private
runtime migration, Windows task installation or 24/72-hour soak was performed.
No background Codex coding continuation was created.

## 2026-10-11: P12 Phase Complete

CI 38131370706 is green at `370e584c60a0bc5d66e5fbacb82f344230a196c3`.
Windows passed on attempt two after the initial Chromium buffer-space failure;
Ubuntu and PostgreSQL passed on the first attempt. Both OS lanes passed all
58 desktop/mobile browser workflows. The integrated minimized-node, batch,
task-scoped routing and mandatory worker-letter tickets now close alongside
the previously verified bounds, checkpoint and synthetic ablation gates.

P12 is complete. Counts: 12/19 phases, 86/128 gates. This is not a live-model
quality claim: optional generic graph/batch dispatch and critique remain off
by default because the measured synthetic variant showed no quality gain.
No agent acquires final-submission authority. P13 and P18 remain open.

Discovery milestone `200a4af36121a4366598ced56b3758da2eec82aa` has its own
pending CI run 38132000459. Preparation-control hardening is under development
and is not covered by the P12 closure SHA. Continue with policy-bound shared
form preparation and independent Windows operation/soak engineering; do not
wait for unavailable private Gmail consent or genuine application receipts.

## 2026-10-11: Verified Discovery And Preparation Controls

Discovery CI 38132000459 is green at `200a4af36121a4366598ced56b3758da2eec82aa`:
589 unit/integration tests and all 58 browser cases on both Windows and Ubuntu;
464 PostgreSQL integration tests. This is public-read checkpoint engineering,
not newly granted job-board permission or operational 20-board coverage.

P13-G1 closes on the previously verified real compiled application's detached
parent-exit test in CI 38131370706. It establishes editor/Codex-independent
operation, not an installed startup task, reboot or completed P13 phase.
Counts: 12/19 phases and 87/128 gates; seven phases remain.

Preparation safety now checks stop and preparation pause through the canonical
answer guard. Production Greenhouse passes the guard before each field and
after inspection; final reread checks earlier values, native validity and exact
CV bytes. Stop/cancel is not misclassified as adapter form drift. Unrelated
discovery/submission pauses remain separate. See the new section in
`docs/evidence/P18-shared-form-core.md`. No extra submission engine or generic
final-click capability was introduced.

Full local check before final error-classification cases: 595 passed / 204
PostgreSQL skipped, 72 files; lint/types/ledger/build passed. Final focused suite:
37 passed, five files. Do not claim a full-local 598 result. This hardening needs
its own remote CI. Previous all-58 local browser evidence predates the new
control/final-readback changes; successor CI verifies their browser compatibility.
Private services, secrets, owner CV/profile/policy, OAuth and Windows tasks were
untouched. No real applications or real-duration soaks ran.

Next implementation: origin/policy-bound shared-form preparation persistence
and operator API/UI, keeping preparation-only readiness distinct from authorized
final-submission readiness. Then extend supported family adapters and coverage
catalog without counting permission-blocked/planned entries as operational.
Continue independent P13 scheduling/capacity/installation work; genuine P08
receipt, Gmail consent, P13 live ramp and real 24/72-hour soaks remain open.

## 2026-10-11: Honest Source Coverage And Browser Control Regression

The discovery workspace and coverage API expose all 20 target boards, LinkedIn
then Indeed first, without counting targets as operational connectors. All 20
remain planned/access-unreviewed; operational boards are zero. Nine implemented
public employer-feed families, configured enabled live feeds and fresh healthy
feeds have separate counts. See `docs/evidence/P18-source-catalog.md`.

Hardening CI 38132799076 failed the document browser fixture on both Windows and
Ubuntu; PostgreSQL passed. The fixture tried to fill while preparation was
paused. It now asserts that rejection, resumes preparation, and retains the
submission pause through review. Production control enforcement was not relaxed.

Full local check passed: 600 tests / 206 PostgreSQL skipped, 73 files, with
lint/types/ledger/build passing. All 58 desktop/mobile browser cases passed.
Public-source scan passed 359 files. Successor CI still needs recording after
push. Counts remain 12/19 phases, 87/128 gates. No catalog
row closes an operational coverage gate; no genuine submission or soak occurred.

## 2026-10-11: P13 UTC-Evidence Day Boundaries

Daily inference quota, task-class accounting and dashboard usage now derive
Amsterdam day windows from UTC creation timestamps rather than trusting the
legacy day label. Submission policy uses the same half-open midnight window.
One captured clock instant binds a reservation's quota check and timestamps.
No private DB migration or historical timestamp rewrite is needed; the legacy
column stays for compatibility but is non-authoritative for quota reads.

New SQLite/PostgreSQL clock regressions cover ordinary rollover, 23/25-hour
days, skipped/repeated clock hours, repository reconstruction, stale day labels
and byte-identical UTC history. Counter fixtures are not a dispatched workflow
or receipt. Full local check passed 609 tests / 212 PostgreSQL skipped, 74 files;
lint/types/ledger/build passed. All 58 desktop/mobile browser cases passed;
public-source scan passed 361 files. Successor CI still needs recording after
push. See `docs/evidence/P13-day-boundary.md`. P13-02 is in progress, not
complete; all remaining scheduling/capacity/installation/ramp gates stay open.

The supported heartbeat creation call again returned tool-unavailable on this
host. No coding continuation was scheduled, and the unrelated paused overnight
pipeline automation was not changed. No real applications or duration soaks ran.

## 2026-10-11: Green Discovery/Clock CI And Operations Development

Source-catalog/control-fixture CI 38133826235 is green on Windows, Ubuntu and
PostgreSQL at `b87ead007ea3c68563e82f7b944afcecb3b5e8e1`. Day-boundary CI
38134321167 is green on all three lanes at
`b8f792016d59958746a0e7d6b538c1b318a53d5f`; both OS lanes passed all 58 browser
cases. T25 clock-counter coverage is now verified, not an OS power transition.

Operations now exposes full-corpus state counts independently of the latest
100 display rows, a receipt/attempt-correlated confirmation count, missing
confirmation evidence and next queued work. Scope is explicitly all-time/all
tracked applications; no daily live target progress is claimed. Positive receipt
coverage uses the existing guarded synthetic confirmation engine. See
`docs/evidence/P13-operations-readout.md`; P13-03 is in progress, not complete.

Full local check passed 610 tests / 213 PostgreSQL skipped, 74 files, with
lint/types/ledger/build passing. The full local browser run passed 57/58: the
desktop document fixture published auto-submit authorization, which resumes
submissions and invalidated its earlier pause. That fixture now reapplies the
submission pause immediately after publishing policy. Production behavior is
unchanged. An intermediate focused run passed both document cases but caught a
desktop queue-navigation accessible name changing with its pending-count badge.
Navigation now has stable names and separate pending-task descriptions. Final
focused document/workspace verification passed all four desktop/mobile cases;
screenshots were inspected for overflow/overlap. Final lint/types/ledger/build
passed. Successor CI still needs recording after push. Public-source scan passed
362 files before this addition.

A fresh isolated synthetic preview runs at http://127.0.0.1:14330 (API 14329),
manager PID 11968, run ID `1d0434eb-acf4-41ac-98cd-f29b4ded26e2`. It explicitly
skips repository .env and inherits only OS runtime essentials. Runtime health
is ready. It is not a production install or qualifying soak. Private 4317/4318
services and all private credentials, facts, authorizations and OAuth remain
untouched. Counts remain 12/19 phases and 87/128 gates; no overnight coding
continuation exists on this host.

## 2026-10-11: Daily Throughput And Target Shortfall

Prior operations CI 38135135228 is green on Windows, Ubuntu and PostgreSQL at
`92b5be1037617b0653a918e3c68a5c89835cac73`. The successor readout adds measured
Amsterdam-day job/application creation, attempt starts, final dispatch starts
and first correlated confirmation receipts, with separate live/synthetic job
cohorts. Later duplicate receipts do not inflate another day's confirmations.
The bounded display-only daily target never changes authorization or limits.
The operations route reuses the matching snapshot's inference budget without
making model calls. See `docs/evidence/P13-operations-readout.md`.

Full local check passed 614 tests / 216 PostgreSQL skipped in 74 files, plus
lint/types/ledger/build. All 60 desktop/mobile browser cases passed, including
the new UNKNOWN summary-fixture/shortfall test. Positive receipt and lost-response
counts use the existing guarded synthetic repository. Screenshots were inspected;
all daily columns fit mobile. The first full run found that the populated-schema
migration fixture called the new summary before dispatch timestamps existed.
It now compares legacy application/audit rows directly through migration and
checks the modern summary after migration; the final full run is green.
Public-source scan passed 363 files before this handoff update.

P13-G6 is code-complete/verification-pending for successor cross-engine CI,
not closed. P13-03 remains in progress until that evidence is recorded. Counts
remain 12/19 phases and 87/128 gates. Next independent milestone is P13 capacity
instrumentation and synthetic workload preparation, alongside remaining Windows
installation/scheduling and shared portal preparation integration. Actual 24/72-hour
soaks, hardware reboot/sleep/network drills and genuine live ramp remain open.

Fresh isolated synthetic preview: http://127.0.0.1:14332 (API 14331), manager
PID 3540, run ID `34f3228f-6558-4f0c-ab51-b1b0cbaa25f3`. Runtime health is ready;
repository .env is skipped and only OS essentials are inherited. Private services,
credentials, authorizations, Gmail consent and all private data remain untouched.
No genuine applications, model calls, soaks or overnight coding automation ran.

## 2026-10-11: Capacity Foundation And Stop-Control Acceptance

Daily-readout CI 38136577373 is green on all Windows/Ubuntu/PostgreSQL lanes at
`419ae73e1cfa6ebbd58b1c1ef713a71bb3ded6bf`. P13-03 and P13-G6 are complete.
Counts are now 12/19 phases and 88/128 gates; the whole P13 phase remains open.

The owned-mock capacity CLI now runs nine exact-outcome scenarios through actual
packet rendering, local artifacts, canonical answers, browser preparation,
queue leases, guarded permits and correlated confirmation/reconciliation. It
rejects external targets/private paths, existing candidate corpora and directory
redirection. Source fingerprint changes, sampling gaps, duplicate attempts,
unexpected server records and resource leaks fail measurement. Reports have
bounded records/bytes, full-corpus task groups, stage timings, disk and Node
memory. Two nine-cycle smoke runs completed in 60.144 and 30.152 seconds, each
with three receipt-backed confirmations and one definitive rejection. No
challenge was solved. See `docs/evidence/P13-capacity-foundation.md` and README.

Mock/handoff/Greenhouse browser entry points share a per-process cap of four
browsers and four contexts, including openings, and release on actual
close/disconnect. Chromium inherits only OS/display essentials, not arbitrary
app secrets. This is not a host-wide cap or browser-child memory measurement.
Matching/letters are clearly synthetic fixture replays and model delay is
simulated. P13-04 is in progress; no actual 24/72-hour soak or live ramp ran.

Stop-control tests prove that stop fences a leased task before permit minting
(LEASE_STALE, no dispatch or server record), and that accepted/lost responses
remain uncertain until read-only reconciliation without another click. The UI
shows the already-sent recall limitation, persists stop across reload and keeps
stage pauses independent through resume. See `docs/evidence/P13-stop-controls.md`.
P13-G5 is code-complete/verification-pending for successor CI, not closed.

Verification: full capacity checkpoint 622 tests / 216 PostgreSQL skipped in
76 files, lint/types/ledger/build and all 60 browser cases passed. Later stop
additions passed both focused integration tests and all four desktop/mobile
operations cases, final typecheck/lint/build and public-source scan (370 files).
The first stop browser fixture raced demo authentication; it now waits for the
authenticated stop button. Screenshots were inspected. Production guards were
not relaxed. Successor CI must verify the combined final build after push.

Preview remains http://127.0.0.1:14332; frontend updates via Vite, while the prior
preview API/worker do not hot reload browser-resource code. Capacity runs are
separate isolated processes and databases. Private 4317/4318 services, facts,
credentials, authorizations and Gmail consent remain untouched. No background
coding continuation exists. Continue independent installation, capacity/whole-host
measurement and server/hybrid engineering; hardware drills, real-duration evidence
and genuine receipts are still required before the affected phases close.

## 2026-10-11: CI Correction And Isolated Windows Host

CI 38138491138 at 80bd3f6 failed; it is not release evidence. Windows TEMP aliases
failed fresh capacity/stop storage guards, and Ubuntu's complete browser sequence
exposed an incorrect pause assertion. Fixtures now canonicalize the TEMP parent
before creating fresh children, without relaxing production redirection checks.
Stop intentionally sets submissionsPaused; resume clears stop without re-enabling
submissions. Discovery/preparation pauses are unchanged. The full browser sequence
now tests this, rather than relying only on focused state.

The local launcher now uses a hidden PowerShell host for start, validate, pinned
version checks and status/stop. Node receives only OS essentials and an explicit
config file. NODE_OPTIONS and arbitrary inherited app secrets are excluded.
The scheduled host waits and propagates the real runtime exit code. Spaced paths,
failed exit 17 and successful validation/control output pass disposable process
tests. Real compiled lifecycle validation and approval/WhatIf tests also pass.
See `docs/evidence/P13-windows-startup-host.md`. No task was installed/removed;
private owner configs, DBs and services were not read or changed.

Local verification: pnpm check passed 626 tests / 216 PostgreSQL skipped, 78
files, lint/types/ledger/build; all 62 desktop/mobile browser tests passed.
Public-source scan passed 375 files. Successor CI must verify the combined
build before P13-G5 closes. Counts remain 12/19 phases and 88/128 gates.
Docker CLI exists but the Linux engine is unavailable; no server deployment was
tested. Continue clean Windows packaging and independent deployment engineering.

## 2026-10-11: Clean Windows Bundle And BSOD Recovery

CI 38139534828 at 53fb044be18853132739d361362c9ce7b689be46 passed Windows,
Ubuntu and PostgreSQL. P13-G5 stop/pause acceptance is now complete: 89/128
gates and 12/19 phases. P13 still has installation/hardware/soak/live evidence
remaining. P17-01 is in progress for independent Windows packaging; it is not
a completed release and its phase dependencies still apply to closure.

pnpm bundle:windows rebuilds a versioned precompiled ZIP with archive and
per-file SHA-256 checksums. Explicit public inputs exclude repo env, private
state, browser sessions, test corpora and dependencies. Final archive bytes
are screened; filesystem redirection, unknown artifacts and stale compiled
runtime files without TypeScript counterparts fail. The shipped manifest
declares dependenciesBundled=false and productionReleaseAccepted=false.
INSTALL.md covers production dependency installation, private config boundaries,
startup approval and the limits of checksums, migration and rollback.

Actual disposable clean installation installs frozen production-only dependencies,
with TypeScript absent. Its compiled factory generates valid synthetic CV/letter
PDF/DOCX, but preserves needs_input for an unreviewed question. Its compiled
API/scheduler become healthy and serve the built dashboard without Vite;
authenticated stop exits zero and both captured child PIDs are gone. This
exposed yazl's development-only declaration; 3.3.1 is now a pinned production
dependency at unchanged resolution. Windows CI runs this opt-in case after build
and uploads ZIP/checksum/metadata under test-results/windows-runtime.

The host BSOD interrupted an in-flight local verification. Edits survived, no
private service was restarted, and no interrupted test was counted as passed.
Fresh sequential pnpm check: 631 passed / 217 skipped, 80 files,
lint/types/ledger/build. Final opt-in clean install passed, plus five bundle
fixture tests; source scan passed 380 files and prod audit found no known
vulnerabilities. Earlier 53fb044 full browser evidence remains 62/62; no frontend
behavior changed in this packaging batch. Successor CI must verify the new batch.
See docs/evidence/P13-windows-bundle.md. No installed logon task, OS fault drill,
actual 24/72-hour soak, private OpenRouter call or live submission was performed.
The old demo preview did not survive reboot. Private 4317/4318 remain untouched.

## 2026-10-11: Bounded Worker Timers And Windows CI Correction

CI 38141281221 at 1d8f194 passed Ubuntu/PostgreSQL, but Windows timed out at
the installer preflight before reaching clean-install verification. Do not
describe that run as a verified Windows bundle. The launcher now invokes its
isolated host in script scope for version/validation/control instead of spawning
redundant nested PowerShell processes. Scheduled startup remains hidden and
separate. The 45-second test bound was not raised; the exact runner timeout
cause is not proven. Focused approval/WhatIf and host exit/filter tests pass.

Worker renewal previously queued a promise on every timer tick, allowing backlog
growth behind slow SQL. Heartbeat/renewal now share a single-flight periodic
primitive: busy ticks are skipped, stop disables scheduling and drains the one
pending write. Error handling releases the slot. No lease, authority, dispatch
or reconciliation check is changed. A blocked DB write still needs the existing
supervisor's bounded shutdown; this is not a database timeout guarantee.
See docs/evidence/P13-periodic-work.md. Four unit cases test 1,000 blocked ticks,
retry/failure/stop behavior; this fake clock is not soak evidence.

Verified 13 focused periodic/lifecycle/host tests and guarded stop workflows.
Final sequential pnpm check passes 635 tests / 217 skipped in 81 files,
lint/types/ledger/build. The rebuilt bundle passes the actual production-only
clean install, semantic packet checks, unknown-answer refusal, compiled API/web
readiness and parent/child drain checks. Scan: 383 files. Successor CI must
verify the combined build. Counts remain 89/128 gates and 12/19 phases.

The owned synthetic preview was healthy at 14334 (run
e7ecc73f-c907-4398-9c6b-ea244624e86c, manager PID 25424). It was gracefully
stopped through its scoped runtime control to load the rebuilt worker, but the
subsequent relaunch was rejected by execution policy. It is currently stopped;
do not claim a live preview or retry a blocked launch through another mechanism.
The synthetic DB remains available; private 4317/4318 and owner configs remain
untouched. No logon task, live application, private model call or long soak ran.

## 2026-10-11: Packaged Guarded Mock Workflow

CI 38155284587 at 97ecc898a16762fe7abb52c764f942a55f3bddaf is now all green:
Windows, Ubuntu and PostgreSQL, including Windows production-only clean install
and browser regressions. P13 remote evidence records its bounded scope.

The successor Windows bundle ships a no-argument compiled release-smoke command
using the existing guarded capacity fixture and one synthetic document fixture.
It ignores owner environment settings, creates fresh isolated synthetic SQLite,
and verifies normal dispatch, lost-response read-only reconciliation and changed
question blocking. Exactly two mock receipts/attempts, zero unresolved outcomes
and no browser resources remain. It does not perform discovery, live matching,
LLM generation or real submissions. See docs/evidence/P17-packaged-workflow.md.

Sequential pnpm check: 636 passed / 217 skipped in 82 files, lint/types/ledger/
build. Opt-in extracted production installation passes 1/1, including the new
compiled workflow, refusal of target overrides, packet checks, API/dashboard
boot and manager/child drain. Public scan: 387 files. Successor CI is pending.
No phase/gate closes: 12/19 and 89/128. Private services remain untouched and
the policy-blocked preview remains stopped. Do not bypass its blocked relaunch.

## 2026-10-11: Server Artifact Backend

Packaged workflow CI 38156771601 at e5c504caa183d267886e11a7aa2cc0ebaa45174f
is all green on Windows, Ubuntu and PostgreSQL, including the Windows extracted
production-only workflow and browser regressions. That verifies the prior batch,
not the successor S3 implementation.

P14 independent engineering now includes encrypted S3 artifacts behind the
existing shared storage contract, wired into API documents/browser and worker
preparation/inspection. Local remains default. Config requires a keyed server,
explicit exact HTTPS storage origin, bucket and region. Existing database,
origin, owner, key and data-directory guards still apply. SDK 3.1149.0 is exact.
Owner-prefixed objects use the existing AEAD codec; conditional writes verify
the winning bytes without overwriting corruption. Bucket readiness, bounded
stream size/time, error sanitization and client shutdown are covered.
See docs/evidence/P14-artifact-storage.md for permissions and actual limits.

29 focused tests pass, including a real SDK/loopback HTTP shared contract and
PDF/DOCX packet readback on both encrypted backends. The first full run was
invalidated by mixed source versions during a readiness edit; final frozen-code
pnpm check passes 652 tests / 217 skipped in 84 files, lint/types/ledger/build.
Production-only Windows installation passes the rebuilt workflow (24.24s);
production audit finds no known vulnerabilities. Successor CI is pending.
P14 and P14-02 are in progress, not complete. No gate closes: 12/19 phases and
89/128 gates. No real S3 service, owner credentials, private services, live
application or soak was touched. Preview remains stopped; do not bypass denial.

## 2026-10-11: Outcome Ledger And Owner Workflow

S3 commit 69862593bb9a80bff93f9509c9e41da07d4755c7 is green in CI
38159025819 on Windows, Ubuntu and PostgreSQL. P14 remote evidence now records
that bounded storage/bundle verification, not complete server/hybrid acceptance.

P16 independent engineering adds an additive owner-scoped outcome ledger,
revision/request guards, attributed append-only corrections and reversal. Gmail
ingestion derives evidence-backed events in its existing transaction; account,
ambiguous or unrelated messages cannot become application outcomes. Owner
corrections and newer/advanced evidence take precedence. Submission state and
policy remain unchanged. Application context lookback is 180 days, signup 14,
with the existing bounded/resumable mailbox acquisition intact.

Authenticated API and Outcomes workspace cover history, manual evidence and
reversal, plus mature receipt-verified outcome fractions. Reports exclude
synthetic, unresolved, unverified and recent records, refuse rates below 20,
state UTC window/denominator/exclusions and preserve UNKNOWN for silence. They
are advisory current-outcome fractions, not conversion or hiring probability.
Membership is not yet an immutable grouped cohort. See
docs/evidence/P16-outcome-foundation.md for detailed methodology and limits.

Frozen-code pnpm check: 665 passed / 228 skipped in 86 files; lint/types/ledger/
build pass. Final desktop/mobile owner workflow passes 2/2; inspected screenshots
and overflow checks pass. Production-only Windows installation passes 1/1 in
23.09s. Successor CI pending; local PostgreSQL cases were skipped, not verified.
Initial browser iterations caught selector naming and client-clock skew; both
are corrected, with final evidence from the passing frozen source.

P16, P16-01/P16-02 and G1/G2 are in progress, not complete. Next: immutable
group-compatible cohorts, score-band calibration, sanitized regression import
and controlled pre-dispatch experiment assignment. P15 dependency remains open.
No phase/gate closes: 12/19 and 89/128. No private services, Gmail/model call,
real submission or long soak touched. The policy-blocked preview remains stopped.
Scheduling was unavailable; no overnight continuation automation was created.

## 2026-10-11: Fixed Reviewed-Relevance Diagnostics

Outcome commit 0d89407d0af245b0d66d7502980b686a15e75696 passes CI
38167046432 on Windows, Ubuntu and PostgreSQL, with full browser regressions
and extracted production-only Windows installation. P16-01, G1 and G2 close on
that code/remote evidence. Counts: 12/19 phases and 91/128 gates. P16 remains
open, as does its P15 dependency; this is not full production acceptance.

The successor batch adds immutable owner-reviewed calibration datasets and
authenticated record/report routes. Scores and synthetic status come from
digest-checked same-owner assessments, not caller assertions. Duplicate canonical
jobs, repeated labels, mixed routes, invalid timelines and changed-identity retries
fail. Minimized datasets remain fixed after source edits and verify integrity on
reads/retries. Policy and submission authority remain unchanged.

Ranking diagnostics exclude synthetic samples, require 20 members and label/score
variation, and report tied-rank Spearman correlation, tie-aware reviewed-relevance
AUC and fixed-band counts. They are subjective reviewed-relevance diagnostics,
not employer selection probabilities or empirical quality claims. See
docs/evidence/P16-score-calibration.md for methodology, API and remaining scope.

Frozen-code pnpm check: 672 passed / 232 skipped in 88 files; lint/types/ledger/
build pass. Rebuilt production-only Windows installation passes 1/1 in 23.13s.
Successor CI pending; PostgreSQL calibration cases were not locally verified.
P16-03 is in progress. Next: grouped fixed outcome cohorts/comparison refusal,
calibration workspace/import and code-version compatibility, sanitized regression
import and controlled pre-dispatch experiments. No private service, live evidence
or soak touched. Preview remains policy-blocked/stopped; no scheduled coding
continuation exists. Do not retry the denied launch through another mechanism.

## 2026-10-11: Privacy-Bounded Regression Maintenance

Calibration commit ecd45c17d923488a0c036ad4c5dbe9a639977256 is green on
Windows, Ubuntu and PostgreSQL in CI 38167896062, including full browser tests
and extracted production-only Windows installation. P16 remote evidence records
that bounded scope; no calibration gate or phase closes.

The successor adds reviewed categorical regression compilation, verified local
workload-correction extraction and a maintainer CLI. Names, facts, provenance,
employer text, URLs, unknown fields and unreviewed inputs cannot become fixtures.
Input is bounded; canonical public metadata is exclusively written under the
unredirected fixture directory, with idempotent exact bytes and generic errors.
The normal integration suite consumes those JSON declarations through the real
chronology, truthful-letter and conservative-mail classifiers. See
docs/evidence/P16-regression-import.md for supported inputs and remaining scope.

Final frozen-code pnpm check: 677 passed / 232 skipped in 90 files; lint/types/
ledger/build pass. Five focused cases include the actual sanitized CLI, changed
bytes, oversized input and redirected-folder refusal. No extra production-only
installation was run for this maintainer-only increment. Successor CI pending.
P16-04/G6 are in progress, not complete: automatic audited proposal capture,
broader fact cases, misclassified forms and adapter drift remain. This is not a
claim that the production application now learns every correction automatically.

Current totals: 12/19 phases, 91/128 gates. Next larger workflow target is fixed
group-compatible outcome cohorts and pre-dispatch experiment assignment/stop
guards, plus private regression proposal capture. P15 dependencies, P08 genuine
receipt, P13/P15 real-duration soaks, server/hybrid and P18 breadth remain open.
Private services and documents remain untouched; preview stays stopped after
execution-policy denial, and no automatic follow-up was created.

## 2026-10-11: Complete Fixed-Review Workspace Workflow

Regression-import commit fb2a4c7a0f41382b6b713e3315f2a1183a352ac1 is green in
CI 38168943996 on Windows, Ubuntu and PostgreSQL, including full browser
regressions and extracted production-only Windows installation. P16 remote
verification records this evidence without closing another gate.

The successor delivers the calibration owner workflow in Outcomes: strict
120 KiB local JSON import, explicit reviewed-label confirmation, exact-identity
save/retry, persisted dataset selection and responsive advisory diagnostics.
The authenticated catalog is owner-isolated, verifies snapshot hashes/IDs and
refuses overflow beyond 1,000 datasets rather than truncating. No labels or
private source content are returned in catalog entries. Ranking diagnostics
remain separate from employer outcomes and never mutate authorization or scores.
See docs/evidence/P16-score-calibration.md for input format, ceilings and limits.

Runtime pnpm check: 678 passed / 233 skipped in 90 files; lint/types/ledger/build
pass. Final full desktop/mobile suite: 66/66 passed (3.9 minutes). Production-only
Windows installation: 1/1 passed (26.58 seconds total). The browser test invokes
production API handlers/migrations with private in-memory synthetic state through
intercepted requests; the measured-report display is an explicit presentation
fixture, not live ranking evidence. Inspected screenshots/overflow checks pass.
Initial full-suite fixture interference and fractional-time normalization were
fixed before the final passing run; final lint/types were rerun afterwards.
Successor CI is pending. No private runtime, mailbox, model call or live action
was touched; preview remains policy-blocked/stopped and no follow-up is scheduled.

Counts remain 12/19 phases and 91/128 gates. P16-03/G4 are in progress, not closed.
Next larger milestone: immutable grouped outcome cohorts with compatible-window
comparison refusal, then pre-dispatch experiment assignment/stop guards. Scoring
code-version compatibility, private regression proposal capture and broader form/
adapter learning remain. Keep real receipts, Windows physical/logon drills,
24/72-hour soaks and server/hybrid acceptance separate from synthetic evidence.

## 2026-10-11: Immutable Fixed Horizon Cohort Workflow

Prior diagnostics workspace commit 2889dbc930de0a0505e05fef946358220a7dc74f
is green in CI 38170532775 on Windows, Ubuntu and PostgreSQL, including full
browser and extracted Windows installation. Matching source review, no-probability
diagnostic contracts and browser assertions close P16-G4 only. Counts are now
12/19 phases and 92/128 gates; P16 and its P15 dependency remain open.

The successor adds owner-audited immutable cohort snapshots in the authoritative
database, typed/digest-verified non-mock receipt qualification, canonical job
deduplication, fixed horizon labels and UNKNOWN silence. Cutoff is server-owned,
exact retry/read preserves frozen evidence after source changes, and changed IDs,
tampering or overflow fail. Catalog/report/compare routes are authenticated.
Comparison requires identical windows/cutoffs/minima and disjoint distinct groups,
with per-group sample refusals. Controls and submission authority stay unchanged.

The Outcomes workspace supports freeze/retry/new snapshot, persisted selection,
group reporting and comparisons. Source and unique stored role-family values are
captured, not reconstructed as submission-time metadata. Seniority/sponsorship
are explicitly UNKNOWN; document templates are not experiment wording variants.
Reports are horizon outcome fractions, not cumulative conversion or causal/hiring
claims. Global pre-grouping exclusions must not be read as per-source exclusions.
See docs/evidence/P16-fixed-cohorts.md for exact methodology, bounds and limits.

Frozen pnpm check: 683 passed / 236 skipped in 91 files; lint/types/ledger/build
pass. Full desktop/mobile suite: 66/66 passed (4.1 minutes), inspected screenshots
and overflow pass. Extracted production-only Windows installation: 1/1 passed
(26.76 seconds total). PostgreSQL cases skipped locally; successor CI pending.
Browser evidence covers real synthetic freeze/retry/reload/refusal, while measured
group arithmetic is fixture-tested, not live data or all metadata acceptance.
No private owner runtime, documents, model/mailbox calls, real action or soak was
touched. Preview remains denied/stopped, with no scheduled coding continuation.

P16-02/G3 remain in progress. Next major milestone is controlled experiment
definition, immutable pre-dispatch single-variant assignment and stop/expiry checks
in the existing guarded engine; receipt/UNKNOWN reconciliation must still work
after stop. The plan's contradictory dispatch sentence is corrected: assignment
must precede dispatch, never follow it. Then complete private regression proposal
capture/broader correction cases, authoritative metadata/version history and the
honest final calibration report. External production drills remain separate.

## 2026-10-11: Controlled Experiment Assignment And Dispatch Guards

Owner-audited immutable experiment definitions and exact reviewed packet
assignments now live in the authoritative database. One canonical job receives
one variant; READY state, no prior intent/attempt/outcome, packet integrity and
assignment caps are checked under the owner lock. No application is created.
The existing final engine checks binding, stop and expiry before intent and again
before dispatch; stopping after dispatch still permits receipt confirmation.
Definitions cannot patch standing policy or authorize submission. Owner routes
and Outcomes review/create/assign/history/stop controls are implemented.

Full local check: 692 passed / 244 skipped in 92 files, lint/types/build pass.
Initial browser suite: 64/66 passed; new selectors needed explicit labels after
options loaded. Fixed affected desktop/mobile workflows: 2/2 passed, page errors
and page-width overflow absent; mobile screenshot inspected. Production rebuild
and extracted Windows install 1/1 pass (25.54 seconds total). Public scan: 426
files. See docs/evidence/P16-controlled-experiments.md. PostgreSQL awaits CI.

Prior fixed-cohort CI 38174100947 failed only its Windows synthetic installer
subprocess after 45 seconds with no output. Its precise delay remains undiagnosed.
The test now allows 90 seconds per subprocess/240 seconds enclosing it, retaining
consent/configuration checks and cleanup; local full suite passes. Do not describe
02db6eb as all-green CI. No gate closed here: still 12/19 phases and 92/128 gates.
P16-05/G5/G7 are in progress, not complete.

Continue directly into receipt/intent-backed immutable experiment-variant cohort
attribution and comparison refusal, then truthful variant generation and private
regression proposals. Definitions currently describe reviewed variants; they do
not generate wording or measure real improvement. Physical Windows/server drills,
live receipts and real 24/72-hour soaks remain unverified. No private owner runtime,
credential, mailbox, model call or employer action was touched. Preview remains
stopped/denied and no background coding continuation exists.

## 2026-10-11: Frozen Experiment Cohort Attribution

Guarded assignment commit b76f513524fb092e8500f4415b13ce351612b21c is green in CI
38177319128 on Windows, Ubuntu and PostgreSQL, including full browser and extracted
Windows installation. The earlier installer failure no longer reproduces within
its bounded successor deadline; its hosted-runner cause remains undiagnosed.

Successor cohort capture freezes reviewed variant/metric/horizon and assignment,
definition, approval and packet hashes. Matching hashed intent, dispatch record
and chronological assignment/intent/dispatch/receipt proof are mandatory for
attribution. Missing/corrupt/post-intent evidence fails rather than silently
becoming unassigned. Legacy records remain unassigned; comparisons require one
definition, matching declared horizon, disjoint jobs and per-group minimum 20.
Stop and later changes do not rewrite frozen evidence. No automatic policy update.

Full local check: 695 passed / 246 skipped in 92 files. Full browser: 66/66 passed
(4.1 minutes). Extracted production-only Windows installation: 1/1 passed
(22.96 seconds total). Public scan: 428 files. Successor CI pending. See
docs/evidence/P16-experiment-attribution.md and the new honest engineering report
docs/evidence/P16-calibration.md, which distinguishes fixture arithmetic from
unmeasured live outcomes and does not assert private database population.

Counts remain 12/19 phases and 92/128 gates. Continue directly with automatic
private owner-correction regression proposals, additional form/adapter cases,
truthful variant generation and compatibility/history requirements. Installed
physical Windows/server and genuine live/24/72-hour gates remain separate; the
existing capacity harness is explicitly non-qualifying. No private owner runtime,
credentials, model/mailbox call, real action or actual-duration soak was touched.

## 2026-10-12: Private Correction Review And Calendar Guard Fix

Attribution commit b9c7410e4169212ffcb56187a24edec10ccbbf57 is all-green in CI
38178099734 on Windows, Ubuntu and PostgreSQL. The successor adds transactional
verified-workload correction proposals in the authoritative private database,
bounded owner review with acknowledgement/CAS, immutable approval/dismissal and
approved-only categorical fixture download. Private source facts and event hashes
are never exported. The maintainer importer accepts strict versioned exports
without weakening its publication acknowledgement or filesystem protections.

Initial browser verification was 67/68: the mobile checkbox was obstructed by a
missing table scroll wrapper. Fixed regression/outcome workflows passed 4/4, and
the final full suite passes 68/68 (4.4 minutes), with compact table screenshots
inspected. Extracted Windows self-test initially failed twice at preparation.
Direct fresh synthetic diagnostics identified Amsterdam-vs-UTC calendar mismatch,
not a proven mixed-build problem. Shared fact/profile/answer validation, worker
generation, inference preparation, chronology display and question resolution
now use the existing Amsterdam day. UTC authorization instants stay unchanged.
Boundary tests cover ordinary/spring/autumn validity and expiry blocking commit.

Full local check: 705 passed / 255 skipped in 93 files; lint/types/ledger/build
pass. Focused boundary/preparation integration: 22 passed / 22 PostgreSQL skips.
Final extracted production-only Windows install: 1/1 passed (23.33 seconds total).
Public scan: 433 files. Successor CI pending. No private owner runtime, secret,
mailbox/model call, real employer action or actual-duration soak was touched.
The synthetic preview remains stopped/denied; no background coding task exists.

No gate/phase closes: 12/19 phases and 92/128 gates. Automatic proposals cover
verified workload corrections only. Continue directly with scoring pipeline
compatibility/history, broader executable form/adapter regression cases and
truthful variants, then independent release/deployment engineering. Real receipts,
physical installation/drills and qualifying 24/72-hour soaks remain separate.

## 2026-10-12: Matching Compatibility And Executable Form Cases

Private proposal commit cfabde72e1954c4b455dc8ebd2259ab79a5c1cce is all-green in
CI 38180066956 on Windows, Ubuntu and PostgreSQL. Existing analytical/experiment
strictness and canonical authorization/dispatch tests close P16-G7 only. See
docs/evidence/P16-policy-adoption-boundary.md. Counts: 12/19 phases, 93/128 gates.

The successor records code-owned matching pipeline versions on new runner
assessments. Fixed calibration derives/fixes model/provider/pipeline/profile
compatibility, refuses mixed/unknown-versus-known histories and checks metadata
digests on catalog/report/retry. Legacy records are not retagged. Diagnostics show
the version and disclose upstream build uncertainty; no weights/policy change.
Reviewed categorical unsupported-required-control and changed-fingerprint
fixtures now execute through actual owned browser inspection/planning/filling,
with zero final writes or accepted applications. Broader automatic capture remains
open; these are generic mock cases, not every external portal variant.

Full check: 710 passed / 257 skipped in 93 files, lint/types/ledger/build pass.
Focused compatibility/matching/rank: 23/19 skips; regression/privacy: 7 passed.
First affected browser run 9/10 exposed an outcome test racing shared worker
preparation. It now owns isolated synthetic production handlers/database, without
shared application mutation. Corrected affected workflows: 10/10 (1.2 minutes),
desktop/mobile version/reload/refusal and analytical state invariance verified.
Extracted production-only Windows install: 1/1 passed (23.64 seconds total).
Public scan: 437 files. Successor CI pending; no broader CI claim for this batch.

Continue into independent release integrity/clean-install engineering, alongside
remaining seniority/sponsorship history, truthful variants and broad correction
capture. Full P16/P15, real receipt/ramp, physical host/server/hybrid drills and
qualifying actual-duration soaks remain open. Private runtime/secrets, model/mail
calls and real employer actions were untouched. No background coding exists.

## 2026-10-12: Native Bundle Verification

Matching/history commit 9a25aaa0446746cbdb1be6f620dab71443610163 passes all CI lanes
in 38180922212 (Windows, Ubuntu, PostgreSQL), full browser and production-only
Windows install included. The successor adds a native-only compiled bundle verifier
before dependency installation, with shared required runtime paths, strict bounded
manifest checks, actual file sizes/hashes, redirect/collision/unlisted-dist refusal,
bounded descriptor reads and optional externally obtained expected manifest hash.
No owner configuration or dependencies are read. No publisher authenticity,
signature, dependency attestation or production readiness is claimed.

Final full check: 727 passed / 258 skipped in 94 files; lint/types/ledger/build
pass. Focused integrity/bundle: 22/1 skip. The Windows file-symlink fixture lacks
privilege (EPERM) and is Linux-only; directory-junction refusal is tested locally.
Initial extracted install found the missing production compiler CLI entrypoint;
the allowlist was fixed and production rebuilt. Final clean production-only
installation passes 1/1 (24.59 seconds total), including native verification before
pnpm, correct/incorrect manifest digests and same-length worker corruption refusal,
then restored artifact, document/self-test and independent runtime boot/stop.
Public scan: 441 files. Successor CI pending. No UI changed in this batch; the
preceding identical frontend is all-green in CI, not a successor full browser claim.

P17-G6 closes using reviewed public distribution inputs, explicit private/source
exclusion, selected-byte scans and actual archive assertions. Counts are now 12/19
phases and 94/128 gates. This does not close P17 or certify arbitrary local/private
files, production signing, live submissions or physical/server/hybrid/soak gates.
Continue directly into the packaged synthetic crash-recovery/challenge workflow
and independent deployment verification. Private runtime/data/secrets were untouched;
no model/mail/employer request or elapsed soak occurred. No background coding exists.

## 2026-10-12: Packaged Crash Recovery And Handoff

Native-integrity commit 9aa8ca3c15753d4aa3e81403aa3cf3ed579e73a0 is all-green in
CI 38181899971 (Windows, Ubuntu, PostgreSQL). The successor compiled recovery
self-test kills its owned mock worker after acceptance, waits for the real task
lease expiry, and uses canonical read-only receipt reconciliation. Two distinct
accepted applications and two confirmed attempts prove no second final action.
A blocked mock challenge verifies the existing encrypted checkpoint contract,
using an ephemeral test key and zero challenge attempts; not real CAPTCHA
handling, persistent private handoff or resumed challenge submission.

See docs/evidence/P17-packaged-recovery.md. Focused source test passes; frozen
full check passes 728 / 258 skips in 95 files; extracted production-only Windows
installation passes 1/1 (62.94 seconds), including compiled recovery with no tsx
and injected private settings ignored. Public scan passed 446 selected files
before independent server-context engineering. Initial failure was corrected:
resource snapshots contain nonzero historical counters, so only active/opening
resources determine release; preparation IDs belong to the nested result.

No new phase/gate closes: 12/19 phases, 94/128 gates. Recovery successor CI is
pending. Continue into screened non-root server images/private topology and
hybrid engineering. Docker CLI registry inspection works but the local engine
is unavailable; do not claim local image/Compose execution. Private ports,
data/secrets and live model/mail/employer operations were untouched. Qualifying
actual-duration soaks, hardware drills and genuine receipt gates remain open.

## 2026-10-12: Screened Server Image And Private Topology

Recovery commit 4bf7a88925229fd440489bd37a3e8fd5a17f4213 is pushed; CI
38182786548 has green Ubuntu/PostgreSQL, Windows pending at this milestone.
The successor introduces a screened public compiled build-context producer,
digest-pinned Node 24.21.0 Linux amd64 multi-stage image, locked production
dependencies, matching Chromium and non-root runtime. API and scheduler use
separate services because the existing local launcher correctly refuses server
installation. Both share one PostgreSQL authority/artifact volume. Secrets
arrive from separately scoped external env files; Compose explicitly selects
its env file rather than loading repository .env. No DB/browser ports publish;
API is host-loopback only, requiring a separately managed HTTPS proxy. Bounds,
init, restart, private network and read-only/dropped-capability settings exist.

See deploy/server/README.md and docs/evidence/P14-server-image-foundation.md.
Focused context/topology tests 4/4; full check 732 / 259 skips in 97 files;
types/lint/ledger/build pass; public scan 454. Actual context preparation: 161
files, manifest e04d8d26b876abcc45e45e116e284eedf6087e42118fe359499d9e67ed71846e.
Docker public registry inspection works; local Linux daemon unavailable and
not started. New opt-in CI lane must prove image build, network-isolated mock
receipts and PostgreSQL service boot/auth/readiness/port isolation. Do not
claim it passed until observed. Its mock receipts still use synthetic SQLite,
not a full PostgreSQL-backed application or hybrid workflow. External final
submissions remain forced off. OS package reproducibility/security, actual TLS,
host sandbox compatibility, migration/restore and hybrid remain open.

P14-01 is now in progress. No gate/phase closes: 12/19 and 94/128. Continue into
fresh Chromium-cache clean-install verification and remaining production
engineering while image CI runs. Private runtime/secrets were untouched; no
live inference, Gmail access, employer submission or qualifying soak occurred.

## 2026-10-12: Fresh Chromium Installation And Image Diagnostics

Recovery commit 4bf7a88925229fd440489bd37a3e8fd5a17f4213 passed every Windows,
Ubuntu and PostgreSQL lane in CI 38182786548. Server foundation d03f9c6 is pushed;
38183327763 has a failed image lane: image build/non-root/runtime checks and
network-isolated mock receipts reached completion, then Compose reported an
unhealthy worker. It did not capture service logs before disposing its synthetic
project, so the underlying cause is unknown. The successor adds bounded service
diagnostics with its generated owner/vault tokens redacted. Do not guess a cause
or call that deployment lane green; inspect the next job logs before fixing it.

The successor Windows installer now downloads matching Chromium into an absent
owned cache, checks the canonical executable remains within it, and propagates
that cache (but no private app settings) to the compiled recovery child. The
actual production-only extracted test passes 1/1 in 104.96 seconds. Focused
recovery/bundle/context passes 11/11; server context 4/4 with image test locally
skipped for unavailable daemon. Types/lint/build pass. See
docs/evidence/P17-fresh-browser-install.md. Full 732-test baseline belongs to
the prior server batch, not this focused successor. Successor CI pending;
P17-G1 awaits its actual Windows proof. Counts unchanged: 12/19, 94/128.

Continue with the server startup failure using bounded synthetic CI diagnostics,
then broader deployment/hybrid and elapsed-soak engineering. Private runtime,
secrets and real model/mail/employer operations remain untouched. No code task
continues outside the current agent turn.

## 2026-10-12: Automatic Form Regression Capture And Trusted Health Probes

Fresh-browser commit 4e571b8d29e1fff172f4387c868a49149c0e19eb has green Windows,
Ubuntu and PostgreSQL in 38183718653; the separate server-image lane failed.
Its redacted logs plus local API reproduction establish a Host-probe mismatch:
server mode refuses loopback/service Host names. Probes now send the configured
HTTPS Host, preserving the exact host guard. Container successor CI is pending.

Browser blocks and known pre-dispatch drift now propose categorical regressions
under existing owner locks/transactions. They retain no private source text or
IDs, deduplicate behavior rather than every job, and still require owner review
before public export/import. Capture-write failures roll back caller state.
Unsupported kinds also block READY storage, canonical answer approval and intent
creation, including optional controls and legacy ready rows. No agent authority,
policy or scoring change was introduced. See P16-automatic-form-regressions.md.

Final frozen full check: 736 passed / 261 skipped in 97 files, lint/types/ledger/
build pass. Initial legacy-row test missed its reviewed fact heads; seeded with
the existing helper and rerun, with no production relaxation. Desktop/mobile
review/export: 2/2. Latest compiled production-only Windows install: 1/1 (125.97s)
with fresh browser download, receipts/recovery and independent boot/stop.
P17-G1 closes at this documented synthetic installation level. Counts: 12/19
phases and 95/128 gates. Full P17, live, physical and server/hybrid gates stay open.

Independent next draft (not part of that frozen regression count):
scripts/owned-processes.ts and its unit/integration tests. Windows CIM/Linux
proc census retains only PID/parent/birth/RSS metadata, fences PID reuse, counts
observed owned orphans and never stores process names/commands/env. Focused 3/3
and a real Windows child census pass. Integrate it into compiled installed
capacity measurement before claiming whole-process or actual-duration soaks.
No qualifying soak is running, and no 24/72-hour evidence exists. Continue
directly after this commit; private ports, profile/secrets and real model/mail/
employer actions remain untouched.

## 2026-10-12: Installed Capacity, Process Census And Actual HTTP Probes

Commit 87d61d7e17fa381b2a6268dd0f47da58a2bc5b77 is pushed; CI 38271280270 has
green Windows, Ubuntu and PostgreSQL, but the separate image lane failed health.
Local socket reproduction confirms Node fetch ignores custom Host; native HTTP
now supplies that exact Host in image/worker health and synthetic CI requests,
without widening trust. API regression tests include a real bound socket (not
only injection), focused API/context 23/23. Corrected image execution pending.

The installed distribution now includes compiled capacity/monitored-capacity
and owned-process census helpers. Installed measurement checks manifest bytes
repeatedly, needs no Git/tsx/private env and uses fresh synthetic storage only.
Mock-only opened/closing callbacks capture live Chromium trees; observer failure
still closes browsers. PID birth fencing/observed orphan tracking, RSS sums,
report/clock/resource bounds, final drain and explicit terminal records are
implemented. Source/dependency/browser authenticity and never-observed/system/
GPU memory are not certified. See P13-installed-process-measurement.md.

Focused process tests 3/3; monitored/capacity/bundle 15/15; full batch 742 / 261
skips in 100 files. Final terminal/drain refinement: monitored 3/3, production
rebuild passes; extracted fresh-browser production-only Windows installation
1/1 in 185.22 seconds, including compiled installed-manifest/no-Git measurement.
Public scan 462 before the new evidence entry. No new UI source changed.
Successor CI pending. Counts remain 12/19 phases, 95/128 gates; no full phase or
soak gate closes. No actual qualifying 24/72-hour run is running or completed.

Continue directly: verify corrected image CI, then arrange a frozen installed
actual-duration resource candidate with truthful scope and independently reviewed
trace/qualification prerequisites. Continue unrelated deployment/hybrid, backup/
restore, portal breadth and outcome engineering meanwhile. Private ports/data/
secrets and real model/mail/employer operations were not used. No background
coding task or goal exists; do not mistake capacity measurement for one.

## 2026-10-12: Windows Census Deadlines And Early Adapter Rejection

CI 38276279477 at 97ea23dc252a12654fa4db81559ddee5a6d72c9f passes server-image,
Ubuntu and PostgreSQL. Actual container health/auth/isolation now passes after
the native HTTP Host correction. This is not a full PostgreSQL-backed mock
workflow, TLS/hybrid deployment or any live receipt. Windows failed bounded
10-second census helpers and the six-browser override test's 15-second deadline.
The underlying runner slowness is not established beyond those timeouts.

Census requests only the four numeric/birth properties via qualified CIM,
with a 20-second helper deadline; collection failure still fails closed and
30-second continuity is unchanged. Native two-census test is bounded at 60s,
fresh installation at 360s with existing subprocess bounds. Each registered
adapter now rejects conflicting packet-backed overrides before any browser/HTTP
work; planning-time validation stays. Eighteen override cases across three
adapters assert zero launches and zero injected requests.

Full local check: 742 passed / 261 skipped, 100 files, lint/types/ledger/build
pass. Expanded SDK 3/3 and typecheck pass. Fresh extracted production-only Windows
installation 1/1 in 131.21s, including compiled monitored capacity, mock workflow,
recovery and independent boot/stop. Public scan 463 before these evidence updates.
Successor CI pending. Counts remain 12/19 phases, 95/128 gates. No actual
qualifying soak is started/completed at this checkpoint; private runtime,
secrets and real employer/model/mail operations remain untouched. Continue with
the frozen installed elapsed resource candidate and independent production work;
never mark its resource trace as the complete P15 outage/quota/fairness matrix.

## 2026-10-12: Frozen Resource Candidate And Intent-Time Attribution

Windows repair 11f793929eb00499434f72fb093f287620c36fdd is pushed. CI 38280309801
passes server-image, Ubuntu and PostgreSQL. Windows native census and adapter
rejection now pass, but monitored capacity returns failed/resource collection
failed before its first cycle. No underlying cause is established by that log;
the successor retains only synthetic aggregate traces for diagnosis. Do not
relax resource/continuity bounds or label Windows CI green.

A hidden compiled 72-hour resource candidate is genuinely running from a frozen
production-only installation, not the repo. See P13-resource-candidate-launch.md
for immutable archive/manifest fingerprints, TEMP-relative recovery paths,
process birth and actual UTC start. First guarded standard receipt and periodic
memory samples are observed; no duration or soak gate is complete. This is an
old-build resource candidate, not the P15 full fault matrix or proof of later
metadata changes. Preserve its installation/evidence. No coding automation was
created: the host's continuation scheduling tool is unavailable. Only this
standalone benchmark can outlive the turn.

New intents now freeze source, normalized role family and synthetic provenance
under their existing digest/owner lock. Cohorts validate intent checksum and
application/job/packet bindings; later job edits do not rewrite new history.
Resolved original listing IDs are supported, conflicting families stay unknown,
legacy records are not backfilled and mixed-provenance source/role comparisons
are refused. Seniority/sponsorship stay unknown. No scoring/policy/agent authority
changes. See P16-intent-time-metadata.md.

Final frozen check 745 passed / 262 skipped in 101 files, lint/types/ledger/build
pass. Final focused reporting/metadata/outcomes 19 / 14 skips. Desktop/mobile
outcome/mock-submission checks 24/24. Fresh compiled production-only Windows
install 1/1 in 139.68s. Earlier broad run overlapped source edits and failed;
only the subsequent frozen full pass counts. Public scan 465 before evidence
updates. Successor CI pending; PostgreSQL cases are not claimed locally. Counts
remain 12/19 phases and 95/128 gates. Private runtime/secrets and real employer,
model and mailbox operations were untouched.

Next: inspect successor Windows failure traces without guessing a cause; keep
independent shared-form integration, server/hybrid, backup/restore and portal
breadth engineering moving. Review the candidate's actual terminal evidence
when available, and rerun affected acceptance on a qualifying stable release.

## 2026-10-12: Hosted Windows Census Startup Investigation

At c8879630bc4fd14b08b935054d2ba602b1e67d95, CI 38282492705 passes server-image,
Ubuntu and PostgreSQL, including new intent/cohort parity cases. Windows fails
both native and monitored census at their initial 20-second helper invocation.
That happens before synthetic trace creation, so no Windows artifact exists;
the absence is explained, not successful measurement. Root cause remains unknown.

The census now preserves the same OS-only prerequisites as the established
Windows startup host: SYSTEMDRIVE, APPDATA/LOCALAPPDATA and PROGRAMFILES variants
in addition to the earlier subset. Application/provider/GitHub secrets and custom
module-search paths remain excluded, with an explicit pure filtering test.
Helper deadline stays 20s and monitored continuity stays 30s. A bounded Windows
CI preflight records startup-only timings under the old and launcher OS subsets,
then one full census timing. It retains no environment values or process records,
and cannot substitute its probe result for native contract tests. Timing JSON is
saved before the full suite for artifact collection even if later census fails.

Focused process/native/monitored tests pass 7/7; types, lint and production build
pass. Local startup probes 186.42ms / 177.38ms, census 407.10ms, all passed under
Node v24.14.0. These local observations do not diagnose hosted-runner latency.
Full 745-test and 24-browser baseline belongs to c887963, not this small helper
successor; CI pending. No fresh installed or qualifying soak claim is added.
Counts unchanged at 12/19, 95/128. Existing frozen candidate remains untouched.

Next inspect the startup timing artifact and native-test results from successor
CI. Shared hosted-form integration also needs explicit owner-reviewed origin
permission (none exists in current authorization contracts), a DNS-pinned public
load transport, a permanent network seal before candidate filling, canonical
answer checks, preparation-only persistence and operator readback. Do not simply
reuse handoff GET routing for arbitrary origins or register a generic submitter.
No generic integration code was committed at this checkpoint. Continuation
scheduling remains unavailable; no coding task runs outside this agent turn.

## 2026-10-13: Parent Birth Fence And Invalidated Resource Candidate

CI 38283813876 at e63f54e passes Ubuntu/PostgreSQL/server-image, not Windows.
Its retained timing artifact shows launcher-subset PowerShell startup 181.31ms,
but full class/property census reaches 20s. Startup is not the demonstrated
bottleneck; the underlying enumeration cause remains unknown. Census now uses
an explicit WQL projection of the same four properties and a 10s provider
operation timeout inside the unchanged 20s child deadline. This is a supported
query variant, not a proven hosted fix until successor CI is observed. Reference:
https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance?view=powershell-5.1

Inspection also found a real ownership defect: a foreign orphan can retain a
parent PID later reused by an owned process. Tracker now requires child birth
at or after the live parent's birth before adoption. Previously observed owned
orphans remain retained; root/child PID reuse fencing and aggregate-only output
remain. Regressions cover older root and descendant-parent aliases, legitimate
new children, and retention of an old owned orphan after its parent PID changes.

The old 72h candidate continued logging; an initial stale snapshot was not proof
of a sampling gap. It is nevertheless invalidated by the ownership defect.
Only its recorded root was stopped after exact PID/birth/command matching; raw
installation/traces remain untouched. There is no qualifying soak running or
complete. It recorded 21 cycles over about 6.7h, seven mock receipts and no
confirmed-without-receipt records. Fresh fixed census saw two reachable processes,
not a recovery of previously observed orphan identities; do not conclude all
earlier resource growth was foreign. See P13-resource-candidate-launch.md.

Focused process/native/monitored tests 8/8. Final frozen full check 747 passed /
262 skipped in 101 files, lint/types/ledger/build pass. Local projected census
434.79ms and startup probes pass; no new installed/remote proof is claimed yet.
Counts unchanged: 12/19 phases, 95/128 gates. Private ports/configuration,
candidate data and real employer/model/mail operations were not accessed.

Next inspect successor Windows CI, then freeze a corrected installed resource
candidate only after appropriate verification. Continue explicit owner-reviewed
origin permissions and safe hosted preparation integration independently. Never
add an arbitrary submitter, reuse handoff routing for arbitrary-origin SSRF, or
grant a model/agent final-action authority.

## 2026-10-13: Owner-Bound Hosted Preparation Milestone

P18-G2/P18-02 complete. Exact origin permissions now have owner-only approval,
expiry/CAS/integrity, audit and restore revocation in the same database. API and
existing inspection tasks share immutable-packet/canonical-policy preparation;
guard checks precede navigation, surround native fill/readback and run again at
persistence. Anonymous public DNS-pinned GET resources, scripts disabled, same-origin
and size/time bounds, no subframes and sealed fill egress. Unsupported/challenged
controls stop; generic preparation never reaches READY, queues submit or gains an
adapter capability. Private Documents approval/prepare/revoke/readback controls
are desktop/mobile verified. See P18-hosted-preparation-integration.md.

Frozen full check: 775 passed /269 skipped, 104 files; lint/types/ledger/build pass.
Full desktop/mobile: 70 passed. Scan 478 files before new evidence documentation;
production dependency audit clean. Synthetic only, including explicit LLM-draft
stubs. PostgreSQL parity awaits successor CI; no employer/model/Gmail calls.
Counts now 12/19 phases, 96/128 gates. No whole phase closed by this milestone.

CI 38323537121 at b3b0e27 passed Ubuntu/PostgreSQL/server-image but failed Windows:
both initial census calls reached 20s; startup probe was 187.29ms. WQL did not fix
the hosted issue. Reader now uses local .NET System.Management four-property WMI
enumeration, disposable rows/searcher and unchanged 10s provider/20s child bounds.
Local diagnostic under full test load: census 599.66ms, startup 204.68/194.39ms.
No raw process/env records retained. Remote success remains unproven until new CI.

Fresh opt-in Windows installation verification is running on this frozen code.
Do not infer a qualifying soak from it; the prior candidate remains invalidated,
and no 24h/72h soak is running. Next record installed/remote results, then correct
stable-build resource measurement while continuing independent P18 breadth and
server/hybrid engineering. Files/custom/sensitive/multi-step/logged-in variants,
20 automated boards and genuine receipt evidence remain open.

### Installed Verification And Corrected Candidate

Fresh installed verification finished: 1/1 in 132.21 seconds, production dependencies
only, compiled runtime/dashboard, standard mock receipt, response-loss correlated
reconciliation, changed-question stop and graceful drain. No logon/reboot/live proof.
The separately frozen bundle's corrected provisional 72h resource trace started
2026-10-13T00:46:02.614Z. First standard scenario confirmed a mock receipt; initial
periodic census is advancing without stderr. Root PID 28712 is recorded with full
UTC birth ticks 639274491605896490, not merely a second-precision timestamp.
See P13-corrected-resource-candidate.md for archive/manifest identities, recovery
paths and limitations. This supersedes "no candidate running" above, not the old
candidate invalidation. It cannot close actual 24/72-hour gates or the full fault
matrix. No coding continuation scheduler is available or claimed.

CI 38328631548 at ca0c4c9 has passed server-image; Windows, Ubuntu and PostgreSQL
lanes were still running at this checkpoint. Do not label them successful yet.

## 2026-10-13: Free-Only Firewall And Native Census

P15-G3 complete; totals now 12/19 phases, 97/128 gates. The positive coefficient
in 1e-9999 previously underflowed to zero; numeric JSON loses it before validation.
Catalogue and reviewed endpoint monetary evidence now requires exact decimal
strings with zero coefficients, not coercion. Zero numeric discount remains a
non-cost marker only. Unknown/tiered/paid/unpriced routes, tools, fallbacks and
manual privacy relaxation still fail. New adversarial tests cover all recognized
cost dimensions and repricing before POST for matching/letters; actual persisted
ready route tests exercise all six node kinds and mandatory LetterDraftRunner.
No real calls, deterministic-letter fallback or additional submission authority.
See P15-pricing-adversarial.md. P15 phase dependencies/other gates remain open.

CI 38328631548 finished: Ubuntu/PostgreSQL/server-image pass, Windows fails two
WMI census tests at 20s. Docs-only successor also fails Windows. The deeper WMI
hosted cause is unknown. Native query-only Toolhelp/process-times/working-set
reader now replaces it, keeps 20s/4MiB bounds, emits only PID/parent/birth/RSS and
does not decode names/commands. Snapshot-time birth fence rejects recycled entries.
Its source participates in capacity fingerprints. Primary interfaces and limits
are in P13-native-process-census.md; local native contracts 8/8, census 459.12ms.

Final pricing/native full check 808 passed /276 skipped, 105 files; lint/types/
ledger/build pass. This preceded the packaging repair: a new clean install
correctly failed because the new helper was absent from the explicit bundle list.
Input and verifier lists repaired, fixture updated, archive inclusion and missing
helper refusal asserted. Final bundle suite 23 passed /one Linux-specific skip;
corrected production-only installation 1/1 in 140.99 seconds. Final lint/types/build
pass. Do not invent a full 809 run or combine these scopes. Source security batch
pushed as 7f63ba3; packaging/evidence follow-up must also be pushed.

CI 38330465431 at 7f63ba3: PostgreSQL/server-image passed; Windows and Ubuntu still
running when recorded. That commit lacks the subsequent bundle repair and may
fail clean installation even if the native census tests pass. Record exact cause,
then verify successor CI; never skip contracts or call all lanes green prematurely.
Current root candidate PID 28712 remains the earlier frozen WMI installation,
two scenarios observed at 01:09Z with one mock receipt and zero missing receipts.
It stays provisional and cannot certify new pricing/native code; no 24/72-hour
gate is complete. Private state/services and real employer/mail/model calls untouched.

Next: verify native/packaging CI, preserve candidate measurement attribution,
complete full fault/backup drills and server/hybrid or portal breadth as independent
engineering. Keep the 20-board target, genuine receipt, physical Windows restart/
sleep/network evidence, complete fault matrix and actual qualifying soaks open.

### Hosted Native Performance Still Open

CI 38330465431 finished: Ubuntu/PostgreSQL/server-image pass, Windows still fails
initial monitored census at 20s. Native child test passed later in 36.81 seconds.
Thus Toolhelp correctness works locally but the hosted delay is not diagnosed.
Do not blame WMI exclusively or claim a successful fix. Last helper markers and a
bounded manual Windows-only diagnostic workflow now isolate compilation, snapshot,
enumeration and serialization. It uses pinned actions and the original 20s bound;
only fixed labels/killed boolean cross the diagnostic error boundary. Local source
native/monitored 8/8 and typecheck pass, diagnostic 607.87ms. No extra gate closes.
Next dispatch/inspect the focused workflow and successor full CI before altering
initialization or sampling deadlines. Physical frozen candidate is not mutated.

Focused hosted diagnostic 38331690969 failed: last marker `started`, killed at20s,
so native enumeration never began. Pin OS-derived built-in PSModulePath, disable
module auto-discovery and explicitly import Utility from the executing PSHOME;
new utility_loaded marker now distinguishes import from compilation. Inherited
user module paths remain excluded. Source/native/monitored 9/9 and types pass;
local census744.62ms. Dispatch successor focused workflow and inspect its actual
result before calling this fixed. Counts stay12/19 and97/128; old frozen resource
candidate continues separately and is not modified.

## 2026-10-13: Hosted Windows Failure Resolved

418d5021c897bf0ebe320f260935b6aac1ba793f is remotely verified. Focused Windows
38332235491:9/9, census2247.57ms. Full38332234815: all four lanes pass (Windows,
Ubuntu, PostgreSQL, server-image). Windows810 passed /276 skipped,105 files;
clean production-only installation1/1 in132.75s and70/70 desktop/mobile cases.
Full-job census2306.32ms, launcher startup146.55ms. Pinning the OS module path,
disabling discovery and explicit Utility import fixes the observed pre-compilation
delay without larger deadlines or skipped contracts. Which individual change was
decisive is not established. No physical restart/sleep/network or soak closure.

Totals remain12/19 phases,97/128 gates; this turn closed P18-G2/P18-02 and P15-G3.
The corrected-but-earlier frozen WMI candidate remains provisional, three scenarios
at01:38Z, one mock receipt, zero missing receipts, no native-code qualification.
It is not changed by later builds and cannot certify418d502 or a future release.
Read its launch record and birth identity before attribution; never infer72h from
process survival. Full fault/backup/restore and server/hybrid/portal breadth remain.

Read-only private readiness probe: configured private settings parse, but loopback
health connection is refused. No stored candidate/application data was read, no
service started/restarted, no private database opened/migrated and no actions sent.
Do not infer current authorization, Gmail consent or suitable live vacancies from
configuration alone. A safe current-data/backup/readiness preflight is needed before
private activation or P08 canary; missing live prerequisites need not halt engineering.

### Hosted Credential/Callback Boundary

Shared hosted public URL guard rejects signed/credential queries and known account,
verification, callback and submission paths, including malformed/nested percent
encoding and decoded separators. Every resource is checked before the reader;
only document/styles/image/fonts load. Unsafe targets open no browser. Ordinary
vacancy/locale/tracking links remain supported; no credential stripping or generic
account verification. Public-origin review is still needed because URL syntax does
not prove remote GET purity. No independent employer-record claim is made.

Full local check before final separator cases826 passed /276 skipped,105 files;
final hosted contracts58 passed /four PostgreSQL skipped. Canonical persisted3/3
also passes, final types/build pass. These are not a fictional full828 result.
Successor CI is needed for this security delta;418d502 all-four-lane green remains
the prior verified milestone. P15-01 moves toin_progress for partial threat review,
not G1 closure. Totals12/19 and97/128 unchanged. Private runtime remains offline;
no private DB migration, real application, mailbox or inference action occurred.

## 2026-10-13: Autonomous Goal And SQLite Snapshot Foundation

Persistent thread goal is active, as explicitly requested by the owner to continue
until full production completion or usage limits. This supersedes historical claims
that no cross-turn coding continuation is available; no cron/heartbeat workaround
was created. Keep the complete19-phase/128-gate objective, not a smaller milestone.

ce416e4 successor CI38336830044 passes all four lanes, verifying the final hosted
credential/callback hardening. New work adds a read-only existing-file SQLite native
snapshot with WAL capture, verified migration history/integrity/owner/stopped controls,
lease/worker refusal, no redirects/overwrites, source-change detection and fresh-copy
verification. Existing restore quarantine is exercised against a captured copy with
identity preserved and submit/replay blocked. Protected staging only: plaintext,
database-only, productionBackupAccepted=false; no private snapshot was executed.
See P15-sqlite-snapshot-foundation.md for explicit bounds and missing full workflow.

Focused snapshot/restore14 passed /four PostgreSQL skipped, types/lint/build/scan
pass. Full check is running on frozen code. No gate or phase closure;12/19 and97/128.
Next build complete encrypted artifact/source/database archives, bounded offline
entry/verification/restore and PostgreSQL parity, then private readiness/activation.
Do not run the mutating doctor against private data as a substitute for this preflight.

## 2026-10-14: Snapshot And External Recovery Fences

Resumed at owner's explicit continue/progress request. Goal service currently reports
usageLimited, not active; the older active-goal note is historical. This turn continues
the requested engineering but does not claim an unlimited background coding run.
Counts stay12/19 phases,97/128 gates. No private data, employer, Gmail or LLM call.

Restore now locks all non-closed employer accounts, invalidates pending/in-flight
signup handles and verification links, advances Gmail generations with detached
token/cursor references, revokes source sessions and clears poll leases. Stop/restore
guards cover account preparation, credential reads and signup authorization. Repeated
entry reasserts external fences for older open quarantines. Release does not silently
unlock accounts; reviewed account recovery, encrypted whole-installation archives,
artifact/source integrity, rekey and PostgreSQL backup/restore remain unfinished.

Final focused46 passed /36 PostgreSQL skipped, five files; types and scan488 pass.
Full frozen successor check passes838 tests /278 skipped,104 passing files /two
skipped in265.15 seconds, plus lint/types/ledger/build. Existing browser-helper lint
and chunk-size warnings remain. Earlier broad results overlapped edits and are not
accepted. P15-03 evidence/next action updated, no gate closure. Successor CI is pending.
Prior provisional PID28712 is gone; last preserved sample covered about5.08 hours,
16 cycles and five mock receipts. No24/72-hour acceptance; preserve the old traces.

## 2026-10-14: Windows Encrypted Backup Workflow

Owner now requests Windows-only delivery and skips Android/other targets. New
server/hybrid/Android work is deferred, not completed or removed from the original
ledger. Preserve existing regression contracts. Amendments13 and the completion
plan record the change. Prior85dbce1 CI38489655882 passes all four lanes.

Delivered actual offline capture/restore CLI and bundled instructions, separate-key
AES-GCM encrypted archive, complete referenced local encrypted document inventory,
vault-key checks, WAL-aware snapshot, bounded ZIP checks and restored-only migrations.
The command runs a256MiB-heap OS-environment-only worker with a five-minute hard
deadline and IPC keys. Failures clean only generated staging after worker exit.
Restore applies durable external-capability quarantine before publishing dataDir;
no service starts, no source migration, no destination overwrite. Config/keys are
not archived. The capture boundary precedes source reads and is stored on restore
runs via an appended migration; review cannot shorten or replace a known boundary.

Full frozen check849 passed /279 skipped,105 passing files /two skipped,283.33s;
lint/types/ledger/build pass. Focused50 /eight skips, five files. Separate COMPILED
CLI capture/restore verifies an encrypted artifact and stopped/restoreBlocked=true
without TypeScript tooling. Scan496 files before this handoff. All fixtures synthetic;
no private database/config/key/CV/model/Gmail/employer action. See WINDOWS-BACKUP.md
and evidence/P15-Windows-backup.md for commands, bounds and missing private proof.

P15-G5 complete for supported Windows local backup integrity. Counts12/19 phases,
98/128 gates; no phase closure. Successor CI pending. Next Windows milestone:
reviewed employer-account recovery and vault/document rekey/rotation, then fuller
crash/reboot drills and qualifying soaks. Nested open-restore backups are refused,
not silently "supported". Protected plaintext staging needs reviewed Windows ACLs
and encrypted disk; a parent/OS crash can leave staging, and deletion is not secure
erasure. Current source requires a new column on activation; private source was NOT
migrated. The archive command supports the prior schema without source mutation.

## 2026-10-14: Fresh-Copy Rekey And Owner Account Review

Prior a490251 backup workflow CI38530880216 passes Windows, Ubuntu, PostgreSQL and
server-image. Windows-only delivery remains current; no Android/server expansion.
This checkpoint closes no new gate/phase:12/19 and98/128 remain honest totals.

Explicit `backup restore-rekey` accepts AUTOPILOT_REPLACEMENT_VAULT_KEY only for a
fresh unpublished archive restore. Both document kinds and all vault-secret purposes
are rewrapped/self-verified, preserving plaintext identities; per-secret versions
increase and counts-only audit records rotation. Source/config/archive are untouched.
Failure after document writes discards the unpublished copy. New-key verification
and ordinary restore quarantine precede publication. Normal restore does not rekey
merely because the environment setting exists. Activation requires separately
reviewing the fresh dataDir and new vault key together; no source migration or
automatic config switch occurs. Remote credentials are NOT revoked by local rekey.

Private local owner-authenticated recovery API/UI supports exact-identity existing
account review with a verified replacement password, or local disabling. Global
external-history restore review must finish first. Owner/tenant, fresh post-lock
review time, expected updatedAt/state and evidence hash are enforced transactionally.
New credentials are sealed; old signup UNKNOWN history is retained, never replayed
or falsely confirmed. Local disable does not delete the remote account. Owner
attestation is not independent login/receipt proof. Global Stop can remain set.

Focused44 passed /16 PostgreSQL skipped, five files. Full check858 /283 skipped,
106 passing files /two skipped in300.04s; lint/types/ledger/build pass. Full browser
suite72/72 in4.4m. Final LOCAL-disable label clarification reverified4/4 account UI
cases in20.2s and production build; core/full-suite results precede only that copy
change. Desktop/narrow screenshots visually inspected without overflow/overlap.
Separate COMPILED CLI smoke verifies rekey + artifact + vault version2 + owner
review while stopped/submissionsPaused remain true. All data/keys synthetic; no
private data/config/service/employer/LLM action. See P15-Windows-rekey-recovery.md.

Remaining Windows recovery work: provider revocation/credential-rotation drills,
nested open-restore and legacy raw-marker boundary handling, parent/OS interruption
and physical reboot/BSOD proof. Then complete the full commit-boundary crash matrix,
qualifying24/72-hour stable-build soaks and broader Windows source/portal readiness.
Do not call rekey remote revocation, owner review an employer receipt, browser
viewport tests an Android implementation, or the prior stopped5-hour trace a soak.
