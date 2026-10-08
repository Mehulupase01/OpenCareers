# OpenCareers Knowledge Transfer

**Prepared 2026-09-28 at commit `4736fc4` on branch `main`, worktree clean.**
Target reader: an autonomous coding agent taking over the remaining work. This
document is written to be acted on without re-deriving anything.

Read this file completely; it is the only orientation you need. Then
`docs/HANDOFF.md` for the running engineering log and `docs/phase-ledger.json`
for machine-readable truth. Two places are worth going to first if you are in a
hurry: **section 13** lists every owner instruction that is *not* in the
Masterplan, and **section 12** is the ordered list of what to do first.
If you read only one file, read this one.

---

## 1. What this project is

A local-first job-application system. It discovers vacancies, decides whether
they suit the owner, generates a truthful CV and cover letter, fills real
application forms in a browser, and submits them under a standing authorization,
recording verifiable evidence for every outcome. The product's central outcome is
a **genuine, receipt-verified submission**, not a draft or a filled form.

The specification is *Job Autopilot Production Masterplan v2.0* (18 phases
P00-P17, 12 requirements R01-R12, 32 integrated scenarios T01-T32). It is
deliberately **not in the repository** because it embeds a private candidate-policy
section. The owner has an offline copy. Everything the repo needs from it is
distilled into `docs/requirements.md`, `docs/architecture.md`, `docs/amendments.md`
and `docs/masterplan-traceability.md`.

## 2. Where the project actually is

```
Phases:  19 tracked (P00-P17 from the masterplan, plus P18 for owner-added scope)
Gates:   72 of 128 complete
Phases complete: 10 of 19  (P00-P07, P09, P10)
Still open:
  P08  6/7   P08-G6 needs one genuine live receipt  (EXTERNAL, needs owner)
  P11  0/7   email integration and receipt reconciliation
  P12  0/6   bounded multi-agent orchestration
  P13  0/7   unattended Windows autopilot and throughput
  P14  0/7   server and hybrid deployment
  P15  0/7   security, crash matrix, restore, 72-hour soak
  P16  0/7   outcomes, calibration, continuous improvement
  P17  0/7   release, portfolio, maintenance handoff
  P18  0/7   owner-account sources, universal hosted forms, portal breadth
```

**Work not in the Masterplan.** The owner issued twelve amendments, several of
which add scope the specification never contained: mandatory real submissions, 11
portal families beyond Ch.07 backlog, a universal hosted-form engine for
arbitrary career pages, and LinkedIn/Indeed ingestion through the owner's own
account sessions. All twelve are indexed in **section 13**. Amendments 7, 8 and 9
are the largest unbudgeted additions and none has been started.

The 55 remaining `not_started` gates are real, unspecced work. Do not treat the
project as nearly finished. The four completed work sessions in this repository's
recent history closed 3 gates, which is roughly the honest rate.

## 3. Ground rules you must not break

These come from `AGENTS.md`, `docs/amendments.md`, and the master's own
non-negotiable definitions. A change that violates one of these is a regression
even if every test passes.

1. **Exactly one authoritative application database per deployment profile.** No
   second store. Never put application state in a Markdown file or a cache.
2. **Only the submission package may initiate a final application action.** No
   browser macro, inbox button, retry helper, or agent node may create commit
   authority.
3. **Unknown external outcomes are reconciled, never replayed.** If an attempt may
   have reached an employer, the only safe next step is reconciliation. Never
   re-click. A lease expiry must never cause a second click.
4. **Model output is a typed proposal, never authority.** A model cannot approve a
   fact, grant permission, arm a submission, or select an unapproved answer.
5. **Fixture-tested is not live-verified.** These are different support levels and
   the vocabulary is load-bearing. Never label a family `live_verified` without a
   genuine private receipt and a date.
6. **Public repository is synthetic-only.** No credentials, CVs, browser state,
   private receipts, or candidate-specific policy. `.env`, `private/`,
   `browser-state/`, `artifacts-private/` must never be committed.
7. **Demo mode may only ever write to the bundled mock ATS.** Enforced in
   `apps/api/src/account.ts` and `packages/mock-ats/src/server.ts`.
8. **Answer propagation uses exact semantics.** Exact semantic key, byte-identical
   meaning, employer, country, valid-date, and evidence-revision checks. Never
   embedding, fuzzy match, or keyword overlap for a legal, work-authorization,
   sponsorship, salary, demographic, or consent answer. A filled control is
   already an answer given to the employer.
9. **A gate is not complete until a named test or inspection backs it.** Evidence
   is absent until something asserts it.
10. **No CAPTCHA solving, challenge-token reuse, fingerprint deception, proxy
    rotation to evade blocks, or anti-bot bypass, and no mass aggregator Easy
    Apply.** These were **requested on 2026-09-16** (amendment 3) and then
    explicitly **retained as exclusions on 2026-09-28** (amendment 10), which
    states they "remain in force and are not overridden". The later amendment
    wins, so this is settled rather than open, but the tension between the two
    entries is real and a future owner may revisit it. Challenges route to the
    P10 visible handoff: the owner solves it in the owned visible browser and
    automation continues from a fresh context. Employer ATS application flows are
    fully in scope and are the product's central outcome. If a future owner
    overrides this, record it in `docs/amendments.md` first.

## 4. Environment and commands

```
node        24.14.0 installed; .node-version pins 24.21.0
pnpm        12.4.2   (always: npx --yes pnpm@12.4.2 <cmd>)
CI          .github/workflows/ci.yml: job local-contract on ubuntu+windows,
            job postgres-contract on ubuntu with a pinned postgres image
```

Install and run:

```powershell
npx --yes pnpm@12.4.2 install --frozen-lockfile
npx --yes pnpm@12.4.2 doctor            # environment diagnostics
npx --yes pnpm@12.4.2 dev                # API 4317, worker, UI 4318
```

`pnpm check` is **only** these five, and nothing else:

```powershell
npx --yes pnpm@12.4.2 lint               # biome check . (format + lint, NO writes)
npx --yes pnpm@12.4.2 typecheck          # tsc --noEmit, whole project incl. tests
npx --yes pnpm@12.4.2 check:ledger       # validate docs/phase-ledger.json
npx --yes pnpm@12.4.2 test               # vitest, see include below -> 35 files
npx --yes pnpm@12.4.2 build              # tsc -p tsconfig.build.json && vite build
```

These are **not** part of `pnpm check` and must be run separately. Do not
assume `check` covered them:

```powershell
npx --yes pnpm@12.4.2 public:scan        # secret / private-path scan over git files
npx --yes pnpm@12.4.2 demo:reset         # reset synthetic workspace first
npx --yes pnpm@12.4.2 exec playwright test   # browser E2E, desktop + mobile
npx --yes pnpm@12.4.2 audit --prod --audit-level high
```

`vitest.config.ts` sets `include: ["tests/{unit,integration}/**/*.test.ts"]` with
`fileParallelism: false` and a 15s test / 30s hook timeout. So `pnpm test`
excludes `tests/e2e/**/*.spec.ts` by design. Unit and integration test files are
excluded on purpose from CI's browser leg and vice versa; neither suite runs the
other's files.

Current verified baseline at `4736fc4`: lint, typecheck, ledger, **227 tests
(82 PostgreSQL-only skips), build, public:scan, and **42 browser workflows
twice consecutively from a fresh reset**, all pass. `audit` reports 4 known
moderate transitive advisories (see section 10).

### The 82 skipped tests are not a detail

`tests/integration/repository.test.ts:32` uses
`describe.skipIf(engine === "postgres" && !postgresUrl)`. Without
`AUTOPILOT_TEST_DATABASE_URL`, every `postgres repository contract` block skips.
So a locally green `pnpm check` has **never executed** the PostgreSQL engine
contract, and the engine-parity promise in `docs/persistence.md` is unverified
locally by default.

To actually run them, point at a **dedicated throwaway** database. Never reuse the
owner's private profile database: `migrate()` runs DDL and the contract tests
create and drop rows.

```powershell
docker run -d --name opencareers-test -p 5432:5432 `
  -e POSTGRES_USER=opencareers_test -e POSTGRES_PASSWORD=synthetic-test-only `
  -e POSTGRES_DB=opencareers_test postgres:16
$env:AUTOPILOT_TEST_DATABASE_URL = "postgresql://opencareers_test:synthetic-test-only@127.0.0.1:5432/opencareers_test"
$env:REQUIRE_POSTGRES_TESTS = "1"
npx --yes pnpm@12.4.2 test        # now 309 tests, 0 skipped
```

`.github/workflows/ci.yml` does exactly this in its `postgres-contract` job
(ubuntu-latest, postgres pinned by digest, `REQUIRE_POSTGRES_TESTS: '1'`), and
runs `local-contract` on an `os: [ubuntu-latest, windows-latest]` matrix using
`node-version-file: .node-version`. **Treat local green as necessary but not
sufficient**, and say so in evidence rather than implying the full suite ran.

## 5. Repository shape

Single pnpm install unit. One root `package.json`; `apps/*` and `packages/*` have
no per-package manifests. Cross-package imports are relative with `.js`
extensions: `../../packages/contracts/src/index.js`.

```
apps/api      Fastify server, route modules: account, browser, candidate,
              discovery, documents, exception, handoff, matching, server
apps/web      React + Vite dashboard. main.tsx shell; workspaces: candidate,
              discovery, matching, documents, exceptions, accounts,
              browser-preparation
apps/worker   durable scheduler: discovery, matching, packets, letters,
              browser adapters, submission, reconciliation
packages/accounts     one-action employer signup (commitSignup)
packages/browser      adapter SDK, adapter-sdk, runtime, prepare, commit-mock,
                      observe-mock, handoff-broker, handoff-policy, recruitee,
                      greenhouse-{inspect,plan,prepare,commit}
packages/candidate    PDF/DOCX ingestion, extract, import, parse-worker
packages/config       env.ts (.env loader) and index.ts (loadConfig)
packages/contracts    Zod schemas and DTOs for every boundary
packages/discovery    connectors, transport, normalize, runner, history, fixtures
packages/documents    packet AST, factory, validation, render, extract,
                      letter-draft, letter-gateway, artifact-store
packages/domain       pure state machine (state.ts)
packages/inference    free-only OpenRouter gateway: gateway, policy, transport
packages/matching     deterministic gates and evidence-bound scoring
packages/mock-ats     owned synthetic ATS (test oracle, not public surface)
packages/observability pino logger with redaction
packages/persistence  17 files: database, migrations, repository, and
                      *-repository.ts per aggregate (account, browser, candidate,
                      coverage, discovery, document, exception, handoff, matching,
                      submission), job-identity, owner-scope, demo
packages/security     vault.ts, AES-256-GCM secret vault
tests/unit (18)  tests/integration (17)  tests/e2e (10)  tests/helpers  tests/fixtures
scripts         dev, doctor, public-scan, demo-reset, validate-ledger,
                generate-p06-goldens
```

Highest version is **migration 10** (`packages/persistence/src/migrations.ts`).
Migrations are an append-only array; `migrate()` checksums each version and uses
`pg_advisory_xact_lock` on PostgreSQL. Adding migration 11 means appending one
array entry. `tests/integration/durability.test.ts` derives its expected count
from `migrations.length`, so nothing else needs editing.

## 6. How to work here

### The loop

1. Read `AGENTS.md`, `docs/HANDOFF.md` (newest entry last), this file, and
   `docs/phase-ledger.json`. Check `git status` before editing.
2. Pick the earliest incomplete phase whose dependencies are met. The ledger's
   `nextAction` is authoritative; do not skip ahead.
3. Implement production behaviour with explicit failure handling.
4. Add tests, **including a negative or recovery case**. A test that only proves
   the happy path does not close a gate.
5. Run `pnpm check`, then `pnpm exec playwright test` after `pnpm demo:reset`.
6. Update the ledger, the evidence doc, and `docs/HANDOFF.md` with real counts.
7. Commit and push. One increment, one commit.

### Commit protocol (owner requirement, in `AGENTS.md` and amendments item 4)

```
Title:  P<NN>: <imperative outcome>          e.g. "P11: correlate receipt emails"
Body:   delivered behaviour, verification actually run with real numbers,
        and remaining limitations. State honestly when something is fixture-only
        or externally blocked. Never claim a gate that has no evidence.
Push:   immediately after each commit, to origin/main.
```

### Never do these

- Do not mark a phase complete to justify a commit. "Never mark a phase complete
  merely to create a commit" is explicit in `AGENTS.md`.
- Do not reformat unrelated files; preserve unrelated changes.
- Do not weaken a validator to make it pass. The ledger validator found nine real
  problems on its first run.
- Do not add a fallback, a default, or a "helpful" silent behaviour where the
  correct behaviour is to fail closed.
- Do not print, log, echo, or commit `AUTOPILOT_OPENROUTER_API_KEY`. The owner's
  key was rotated 2026-09-28 and lives only in the ignored `.env`.

## 7. Remaining work, in dependency order

This is the critical section. Ordered so each increment is unblocked by the ones
before it.

### A. P10 follow-ups (phase is closed; these are tracked gaps)

**A1. The `reconcile` inbox action is a silent no-op. Fix this first.**
`ACTION_PERMISSIONS.needs_review` offers `reconcile`, but `ExceptionRepository.resolve`
implements no such branch, so the action marks the exception `resolved` while the
application stays in `NEEDS_REVIEW`. This is an unknown outcome being recorded as
settled, which rule 3 forbids. Either implement it through the reconciliation path
or withdraw it from the action list until P11 can honour it, and add a test. Full
analysis in section 10.

**A2. Account/session exception mapping (Appx.B scenario T32).**
`packages/browser/src/greenhouse-inspect.ts` produces `blocker: "login"` but no
exception state maps to it; commit paths classify `422` as definitive and
everything else as unknown, so an expired employer session is indistinguishable
from a network fault. Add an account-exception outcome to the adapter contract,
bound the retries, surface it in the inbox. Files: `adapter-sdk.ts`,
`greenhouse-inspect.ts`, `exception-repository.ts`, `state.ts`.

**A3. Ledger `lastVerifiedCommit` hygiene.** P10 is `complete` with a stamped
SHA. Other completed phases carry older SHAs. Re-stamp only when you actually
re-run that phase's verification.

### B. B1 letter path (needs an owner decision, see section 8)

Amendment 5 in `docs/amendments.md` rejects a deterministic cover letter for any
real auto-submit packet, and `SubmissionRepository` enforces it via
`assertExternalLetter`. Today no free route can satisfy all three invariants.
The intended fix: code selects approved contribution IDs deterministically and
binds them to facts; the model authors bounded prose; an independent validator
checks every claim. Structured outputs are then not required *from the model*
because the structured part is code-owned. Files:
`packages/documents/src/letter-gateway.ts`, `letter-draft.ts`,
`packages/inference/src/gateway.ts`, `packages/persistence/src/document-repository.ts`.

### C. P18 owner-added scope (phase plan: `docs/plans/P18-owner-sources-hosted-forms.md`)

**C1. P18-01 encrypted browser-storage vault.** Reuse `VaultCipher` in
`packages/security/src/vault.ts` with the already-declared `browser_storage`
purpose. Migration 11 adds `owner_sessions`. Returns metadata always; decrypted
state only for exact owner + origin + adapter, zeroing the buffer after use. This
is the highest-risk item in the remaining work because it introduces a **new
credential class** the system has never handled: storage state, cookies, refresh
tokens. Never let session material reach a prompt, a log, an audit payload, an API
response, or Git.

**C2. P18-02 universal hosted-form engine.** Inspect an arbitrary approved-origin
career page, map labelled controls to semantic keys, fill only recognized
low-risk fields, and **stop as `unsupported` at ambiguity**. An unlabelled
control, a duplicated label, or a value that cannot be read back exactly must not
be guessed, because a mis-mapped control is a false statement to an employer. The
engine may never auto-submit. Reuse primitives in `packages/browser/src/adapter.ts`.

**C3. P18-03 LinkedIn, Indeed and comparable boards via the owner's own sessions.**
Amendment 9 (2026-09-28) is explicit: the owner has **already confirmed** that
third-party accounts this system holds a session for are **the owner's own
accounts**, and directs logged-in job discovery and detail ingestion for
**LinkedIn, Indeed, and comparable boards**. That overrides the masterplan Ch.02
exclusion of restricted logged-in scraping. The *authorization* question is
therefore settled; do not treat this increment as blocked on it. Only the
specific account list is unconfirmed. LinkedIn and Indeed are named directly and
are not covered by C4 or C5, so build them explicitly.

Read-only ingestion over the owner's own logged-in sessions, bounded rate with
persisted cooldown, and the same raw-evidence and count-drop-warning discipline as
a public connector. Detail views cost more and yield less than search listings,
so bound them and record why. **Never write to a third-party account**: no
messages, no follows, no applications outside the P07 submission package, no
profile edits. Session material is a credential: encrypted at rest, never in a
prompt, log, audit payload, or API response, and excluded from source control.

**C4. P18-04 public-API families.** Ashby, Teamtailor, SmartRecruiters,
Workable, Personio, Breezy. Per family: Zod wire schema, a `normalizePage`
branch **before the Lever fall-through** in `connectors.ts`, a URL-builder branch,
`hostedUrl`/`recognizeUrl` branches, an approved host in `transport.ts`, a fixture
branch in `fixtures.ts`, a coverage row (the `Record<Family,...>` in
`coverage-repository.ts` will not compile until you add one), and one dated
read-only public sample recorded in `docs/sources/`.

**C5. P18-05 account-gated families.** Workday, SuccessFactors, iCIMS, Jobvite,
BambooHR, each through the P10 vault for signup/login then the P07 SDK for the
lifecycle. Rank by measured yield from `GET /v1/discovery/coverage`, not by
platform fame.

### D. P11 email integration (`docs/plans/P11-email-reconciliation.md`)

Closes T23 and T24, and **retires real technical debt**: `reconcile()` on both
`RecruiteeSubmissionAdapter` and `GreenhouseSubmissionAdapter` currently returns
`null`, and `SubmissionRepository.reconcileReceipt` throws `ADAPTER_UNSUPPORTED`
for anything that is not `mock_ats`. P11's job is to make correlated email
evidence close those. Account-created mail is **not** an application receipt.
Two roles at one employer must not share a receipt without identity evidence.
Idempotent by message id; a bounded mailbox cursor and backfill window; the app
must stay fully useful with the mailbox disconnected.

### E. P12 through P17 (masterplan phases, plan docs already written)

Each has a decision-complete plan in `docs/plans/`. Execute in order; do not
re-plan. Highest-value notes:

- **P12**: the masterplan Ch.08 daily allocation is a hard spec (triage 5,
  drafting 13, critique 13, novel questions 4, repairs 5, probes 2, reserve 8).
  An ablation must show the multi-agent path actually beats the deterministic
  baseline, or it is not enabled by default.
- **P13**: daily counters use Europe/Amsterdam with DST correctness; a submission
  started before midnight and confirmed after is reported consistently. The
  dashboard must explain a shortfall by measured stage, never by relaxing rules.
- **P14**: hybrid mode keeps one authoritative database on the server; the local
  worker is a browser worker only; database and browser-control ports are never
  public. A profile switch requires explicit drain and reconciliation.
- **P15**: `restoreBlocked` is honoured at every read site but has **no writer and
  no test**; `Repository.setControl` omits it by type. A restored system older than
  its last external submission must not be able to commit until reconciled.
- **P16**: no rejection inferred from silence, no interview probability, no UI
  showing match score as selection probability, no policy change without a
  recorded owner policy revision.
- **P17**: publish synthetic material only; never relabel fixture-tested as
  live-verified; a rollback must preserve the application ledger.

### F. Cross-cutting conformance work (`docs/masterplan-traceability.md`)

- **Appendix A**: only 2 of 16 specified endpoints match exactly, 8 exist as
  domain-equivalent variants, 6 are absent. The API is organised by bounded
  context, not by resource.
- **Event envelope**: 6 of 13 required fields present. Missing:
  `schema_version`, `aggregate_type`, `actor_type`, `actor_id`, `causation_id`.
  `correlation_id` currently carries aggregate identity instead of a trace id,
  and `payload` is stored unredacted. This needs a migration.
- **Scenarios**: 15 covered, 11 partial, 6 missing (T23, T24, T26, T27, T28, T32).

## 8. Blockers that require the owner

Do not attempt to work around any of these. Do not fabricate a receipt, a live
result, or a credential.

1. **OpenRouter key rotation done; a privacy decision is not.** Measured
   2026-09-28 (`docs/evidence/B1-free-route-probe.md`): of 20 free models, 3 are
   zero-data-retention eligible and 4 advertise `structured_outputs`, and the two
   sets are disjoint. All NVIDIA free routes return HTTP 404 for ZDR, so the
   owner's amendment-11 request for Nemotron cannot be satisfied under the
   project's privacy invariant. `qwen/qwen3.8-27b:free` has been **retired** from
   the free tier, which explains the earlier 429s. The owner must either accept
   the code-owned-evidence-selection letter path (section B) or enable a
   ZDR-capable provider in their own OpenRouter account settings.
2. **P08-G6** needs a published standing authorization with final-click
   authority, a suitable live vacancy, and presence to verify a private receipt.
3. **P13-G7** needs a real live ramp; reaching 50 is a measurement, never a claim.
4. **P18-G1/G3** need the specific third-party account list the owner's LinkedIn
   and Indeed sessions belong to. Authorization is already granted by amendment 9;
   only the account list is missing. Do not treat this as blocked on approval.
5. **P14** needs a hosting account and budget when that phase is reached.
6. **P17-G2** needs the private installation to make a real authorized submission.
7. **Outreach messaging** is currently excluded from P18 scope and needs an
   explicit decision.
8. **24-hour and 72-hour soaks** need wall-clock time, not effort.

## 9. Environment traps that will cost you time

Discovered the hard way in this session. Each one produced a confusing failure.

**Ports 4317/4318.** Browser tests need them. The owner's private `pnpm dev`
occupies them. `playwright.config.ts` now sets `reuseExistingServer: false`,
forces `AUTOPILOT_PROFILE=demo` and `AUTOPILOT_SKIP_ENV_FILE=1`, and
`tests/e2e/global-setup.ts` refuses to run unless the server on 4318 reports
profile `demo`. **Stop the private service before `pnpm test:e2e` and restart it
afterwards.** This is deliberate: an earlier configuration let a browser test run
against the owner's real candidate database.

**`.env` loading overrides the ambient environment.**
`packages/config/src/env.ts` calls `node:process`'s `loadEnvFile`, which
assigns over `process.env`. `AUTOPILOT_SKIP_ENV_FILE=1` is honoured to bypass it.
Related: `loadConfig({})` parses an **empty** object and ignores `process.env`
entirely. To read real configuration in a script, call
`loadConfig(process.env)`.

**Authorization expiry is bounded.** `POST /v1/candidate/authorization` rejects an
expiry more than 90 days after the effective date, and rejects one already past.
Use `new Date(Date.now() + 30 * 86400000).toISOString()`.

**Demo seeds jobs but no discovery listings.** A spec that needs a vacancy must
call `ensureListing(page)` from `tests/helpers/browser-setup.ts`, which creates
and polls its own fixture source and excludes jobs already confirmed or in flight.
`ensureCandidate(page, suffix)` guarantees the profile, authorization, and the
reviewed identity, employment, skill, language and work-authorization facts the
eligibility gates need. **Both are required for a spec to pass in isolation.**

**Eligibility needs real evidence.** Matching returns `review` rather than an
eligible application whenever a gate is unresolved - see the `gate(...)` calls
and `"review"` literals in `packages/matching/src/domain.ts` (work-authorization
unknown, vacancy country unknown, and several others). A minimal identity-only
profile will not reach an eligible outcome, so the spec fails at "Expected an
eligible application". Use `ensureCandidate`. Read
`packages/matching/src/domain.ts` for the real gate set rather than guessing a
threshold.

**Actual route names (verified).** The API is organised by bounded context with
bare collection routes, not the paths in Appendix A. Use these:

```
POST /v1/candidate/profile                  publish a profile version
POST /v1/candidate/facts                    add a fact
POST /v1/candidate/facts/:id/review         record an owner review decision
POST /v1/candidate/answers                  answer a question
POST /v1/candidate/authorization            grant standing authorization
POST /v1/candidate/sources                  import a CV, DOCX or PDF
GET  /v1/discovery/coverage                 per-family coverage and yield
GET  /v1/discovery                          discovery run list
POST /v1/discovery/sources/:id/poll         start a poll for one source
POST /v1/discovery/identities               record a job identity
POST /v1/discovery/identities/:id/split     split a merged identity
POST /v1/documents/generate                 generate a packet
GET  /v1/exceptions                         inbox
POST /v1/exceptions/:id/resolve             record a decision
POST /v1/exceptions/:id/rebuild             reconcile-then-rebuild a stale form
GET  /v1/operations/summary                 per-application operational state
```

There is no `POST /v1/candidate/profile/publish` and no `POST
/v1/discovery/run`. Both appear in the masterplan's Appendix A and neither
exists. `POST /v1/exceptions/:id/rebuild` reads `exception.applicationId` and
passes it straight to `rebuild()` without a null check, while the contract types
that field as nullable; a non-application-attached exception is the untested edge.

**`page.request` does not inherit the browser cookie jar.** A state-changing
request through it needs an explicit `origin` header, or the API answers 403.
`makeJson` in `tests/helpers/browser-setup.ts` does this.

**Fake clocks do not advance.** Tests inject `() => new Date(now)`. A challenge
preparation's `expires_at` is compared against that fixed instant, so a fixture
built with a real `Date.now()` boundary reads as already expired. Keep fixture
timestamps consistent with the injected clock.

**Ordering must be explicit.** `id` columns are random UUIDs, so `ORDER BY
occurred_at, id` is arbitrary when many rows share one timestamp from a fake
clock. `exception_actions` carries a monotonic `seq` for exactly this reason; any
new append-only table needs the same.

**No nested transactions.** Calling a repository method that opens its own
transaction from inside another deadlocks against the owner row lock. This is why
`ExceptionRepository` writes approved answers through a `SqlExecutor` variant
rather than calling `CandidateRepository.saveAnswer`.

**Schema names differ from intuition.** There is no `profiles` table (it is
`profile_versions`), no `status` column on `fact_heads` (review state lives in the
fact version `data`), and `intents` has no `fence` column. Read
`packages/persistence/src/migrations.ts` before writing raw SQL.

**Biome forbids non-null assertions** (`lint/style/noNonNullAssertion`). Write
the guard instead of `item!`. `pnpm format` fixes formatting but not lint
warnings; read the remaining list.

## 10. Known tracked issues

- **Dependency advisories.** `pnpm audit --prod --audit-level high` passes, but
  4 moderate advisories exist in transitive deps, published after the last
  supply-chain pass: `fast-uri` 3.1.7 and 4.1.4 (GHSA-hrr3-gc8f-f4qj,
  GHSA-jvvf-x445-j334), `fastify` 5.12.4 (GHSA-4mh8-r7rc-xpvc). Reachability
  analysis is in `docs/evidence/P10-closeout-checkpoint.md`. The fix
  (fastify >= 5.12.5, fast-uri override) belongs to P15-04, which owns supply
  chain, SBOM, and release scanning. Do not force a lockfile change in an
  unrelated increment.
- **`reconcile` is a no-op that silently resolves an exception (highest-priority
  bug found during handover, unfixed).** `exception-repository.ts:31` offers
  `reconcile` as a permitted action for the `needs_review` blocker, but
  `resolve()` handles only `open_session` (line 111), `resolve_answer` (122),
  `skip` (124) and the `defer`/`retry` bookkeeping (130-141). Passing
  `action: "reconcile"` therefore performs **no reconciliation at all**, sets
  `status = 'resolved'` because the action is not `defer`, and requeues nothing.
  The application stays in `NEEDS_REVIEW` forever while the inbox shows it as
  handled. This is exactly the "unknown outcome silently treated as settled"
  failure the masterplan forbids. Fix by routing `reconcile` into the
  reconciliation path and refusing it until one exists, or by removing it from
  `ACTIONS.needs_review` until it can be honoured. Add a test either way.
- **Reconciliation is unimplemented for every non-mock adapter.** See section D.
  Until P11 lands, an ambiguous Recruitee or Greenhouse attempt ends in
  `ADAPTER_UNSUPPORTED` rather than being resolved. `reconcile()` on both
  `RecruiteeSubmissionAdapter` and `GreenhouseSubmissionAdapter` returns `null`.
- **`rebuild_form` is not offered in the inbox UI.** `ExceptionRepository.rebuild`
  exists and is reachable at `POST /v1/exceptions/:id/rebuild`, but the
  `ACTIONS` map does not list it, so the UI cannot trigger a rebuild. Wire it up
  only once the rebuild path is safe to offer from the UI, and add the
  `applicationId` null guard noted in section 9.
- **Browser suite is hermetic but not parallel-safe.** It shares one worker and
  one database and runs with `workers: 1` by design.

## 11. Documents that matter, and what each is for

| File | Read it for |
|---|---|
| `AGENTS.md` | Binding repository rules. Short. Read first. |
| `docs/HANDOFF.md` | Running engineering log, newest entry last. Resume point. |
| `docs/masterplan-traceability.md` | R01-R12 and T01-T32 mapped to real tests, with honest gaps. |
| `docs/phase-ledger.json` | Machine-readable truth. `nextAction` per phase is authoritative. |
| `docs/amendments.md` | Owner instructions and precedence. Items 6-12 are 2026-09-28. |
| `docs/architecture.md` | ADR-001..ADR-011, four deployment profiles. |
| `docs/requirements.md` | R01-R12 traceability. |
| `docs/plans/*.md` | One decision-complete plan per phase. Execute, do not re-plan. |
| `docs/evidence/*.md` | Per-phase verification records with real counts and boundaries. |
| `docs/sources/*.md` | Dated third-party research. Read before touching a portal. |
| `docs/persistence.md` | Schema, engine parity contract. |
| `docs/security/threat-model.md` | Risk to control table. |

## 12. First actions for whoever picks this up

1. `git status`, then read `docs/HANDOFF.md`'s last entry and this file.
2. `npx --yes pnpm@12.4.2 install --frozen-lockfile`
3. `npx --yes pnpm@12.4.2 check` to confirm the baseline at `4736fc4`.
4. Ask the owner about the B1 letter decision (section 8 item 1) if it has not
   been answered.
5. Fix **A1**, the `reconcile` no-op. It is small, self-contained, and it removes a
   real "unknown outcome silently recorded as settled" defect. Do this before
   any new feature work.
6. Then take **A2** (T32) or **C1** (P18-01 session vault), both of which need no
   owner input. Do not start P11-P17 before P18-01, because P14-G6, P15-G3 and
   P17-G6 all depend on the session vault existing.
7. One increment, one commit, one push. Update the ledger and the evidence doc
   with real numbers before claiming anything.

## 13. Owner instructions that are not in the Masterplan

The masterplan is a 2026-09-16 edition. Everything below came from the owner
**later** and is authoritative under amendment 6, which states the conversation
overrides the specification where they conflict. Full text in
`docs/amendments.md`; this table is the index. Amendment 3 predates the later
batch and is partly superseded by item 10.

| # | Instruction | Status | Where planned |
|---|---|---|---|
| 1 | Use the existing OpenCareers repo at `D:\Mehul-Projects\OpenCareers`; keep name, history, license | Applied | this repo |
| 2 | **Automatic final clicks and real submissions are mandatory.** Review-only and fill-only are optional modes and do **not** satisfy the delivery goal | Delivered as design; **one real receipt still outstanding** | P08-G6 |
| 3 | Requested CAPTCHA bypass, anti-bot evasion, proxy rotation, restricted logged-in scraping; feasibility to be investigated; account access must be owned or authorized; do not claim universal coverage | **Feasibility never investigated. Superseded in part by item 10.** No bypass or logged-in scraping performed | ground rule 10 |
| 4 | Commit and push to the existing origin after each phase; descriptive title and body; continue autonomously between checkpoints | Applied | section 6 |
| 5 | Real applications need LLM-drafted letters; the deterministic P06 letter is retained **only** for synthetic demo and non-committing review paths; model downtime must never silently substitute a deterministic letter | **Open — blocked on the model decision** | section B, `docs/plans/P06-llm-letter-amendment.md` |
| 6 | Conversation authority overrides the masterplan | Applied | this section |
| 7 | Portal breadth is **required**: 6 public-API families (Ashby, Teamtailor, SmartRecruiters, Workable, Personio, Breezy) and 5 account-gated (Workday, SuccessFactors, iCIMS, Jobvite, BambooHR). Workday-class backlog items are now in scope | **Not started, 11 families** | C4, C5 |
| 8 | Arbitrary company career pages must work via a universal hosted-form engine; ambiguity stops as `unsupported`, never guesses | **Not started** | C2 |
| 9 | LinkedIn, Indeed and comparable boards via the owner's **own** account sessions; overrides Ch.02; session material is a credential | **Not started** | C3, C1 |
| 10 | Ch.01 exclusions (CAPTCHA solving, challenge-token reuse, fingerprint deception, proxy rotation to evade, anti-bot bypass) **remain in force**; also no mass aggregator Easy Apply. Challenges route to the P10 handoff | Applied | ground rule 10, P10 |
| 11 | Free-only inference must actually work; use any free OpenRouter model or NVIDIA Nemotron 3 Ultra on OpenRouter; per-route ZDR eligibility must be **probed, not assumed**; if nothing works, record as external blocker and never relax privacy | **Probed 2026-09-28 — no free route satisfies all three.** External blocker | section 8 item 1 |
| 12 | Owner's OpenRouter key was pasted into chat and must be rotated before live route work; the repo never contains it | **Rotated**, confirmed by owner | `.env`, ignored |

### Amendment 11 detail worth not re-deriving

The owner's 2026-09-28 catalogue read found
`nvidia/nemotron-3-super-120b-a12b:free` zero-priced in both dimensions **with**
`structured_outputs`, and `nvidia/nemotron-3-ultra-550b-a55b:free` zero-priced
**without** advertised structured outputs. The subsequent ZDR probe in
`docs/evidence/B1-free-route-probe.md` returned HTTP 404 for zero-data-retention
on **every** NVIDIA free route, which is a provider-property rejection rather than
a transient error. Do not re-probe these hoping for a different answer; the two
invariants (ZDR and structured outputs) are not simultaneously satisfiable on any
free route measured on 2026-09-28.

### Work that is genuinely in flight right now

**None.** At `4736fc4` the worktree is clean, the only branch is `main`, there is
no stashed or uncommitted change, no TODO/FIXME marker exists anywhere in
`packages/*/src`, `apps/*/src` or `tests/`, and every browser test is
deterministic. This document, the ledger, `docs/plans/` and the tracked issues in
section 10 together constitute the complete pending list. If you find work that
is not in any of those, that is a finding, not an oversight on your part.

## 14. Honest summary of the remaining work

The four most recent completed sessions closed roughly three gates and one phase.
The remaining 55 gates belong to seven never-started phases plus the
owner-added breadth phase, and several of those phases (P13 unattended
operation, P14 deployment, P15 soak) require wall-clock time or owner
infrastructure rather than only code. The foundation is genuinely solid and
honestly tested; the breadth is not there yet. Treat this as roughly half a
product by gate count, and considerably less than half by demonstrated capability,
because no genuine external submission has been receipt-verified.

Do not report progress the evidence does not support. The repository's own value
is that its claims are true, and that property is worth more than speed.