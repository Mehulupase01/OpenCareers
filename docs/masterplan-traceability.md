# Masterplan Traceability

Audited 2026-09-28 against Job Autopilot Production Masterplan v2.0 (2026-09-16), 58
pages, 18 phases, R01-R12, 32 integrated scenarios, four deployment profiles.

This file records what the repository actually proves today. It is a baseline, not
a claim of completion. Rows are marked covered only where a named test asserts the
scenario invariant; a passing adjacent test is recorded as partial, and a missing
row names the production code that must change. Masterplan clause references use
`Ch.NN` for chapters, `Appx.A`-`Appx.F` for appendices.

The masterplan PDF is intentionally excluded from source control because it
contains a private candidate-policy section (`docs/requirements.md:3-4`). This
audit was performed against an offline copy supplied by the owner on 2026-09-28;
no masterplan text, and no private policy field, is committed here.

## Requirement Traceability

| ID | Requirement | Phases | Gate evidence | Audit verdict |
| --- | --- | --- | --- | --- |
| R01 | Ingest direct company vacancies and supported job feeds | P04, P09, P18 | `docs/evidence/P04-verification.md`, `P09-coverage-verification.md` | Covered for 3 ATS families. Owner-account and generic career-page sources are P18 work. |
| R02 | Avoid duplicate applications across sources and restarts | P02, P04, P08, P15 | `P02-verification.md`, `P04-verification.md`, `P08-engineering-verification.md` | Covered intra-source and via owner merge. **Partial across three independent sources**: see T01. |
| R03 | Rank Netherlands-compatible roles with explicit reasons | P03, P05, P16 | `P05-verification.md` | Covered: 72-case frozen set plus 12-case holdout. Branch coverage gaps in T04-T06. |
| R04 | Preserve verified candidate facts and original files | P03, P06 | `P03-verification.md`, `P06-verification.md` | Covered. Provenance, immutable revisions, content-addressed artifacts. |
| R05 | Generate a tailored CV and optional motivation letter | P06 | `P06-verification.md`, `P06-llm-letter-checkpoint.md` | Covered deterministically. **LLM letter path is not live-verified** (Ch. amendment 5); B1. |
| R06 | Fill and finally submit supported forms | P07-P09, P18 | `P07-verification.md`, `P09-greenhouse-lifecycle.md` | Mock lifecycle covered. P08-G6 is `blocked_external`: no genuine receipt exists. |
| R07 | Recover ambiguous submissions without blind replay | P02, P08, P15 | `P02-verification.md`, `P08-engineering-verification.md` | Covered by SIGKILL and lease-expiry suites. Full commit-boundary matrix is P15-G2. |
| R08 | Continue around challenges and missing information | P07, P10, P13 | `P10-security-checkpoints.md` | Partial: queue isolation proven; no exception inbox exists, so an owner cannot yet act on a blocker. A2. |
| R09 | Prevent paid inference in free-only mode | P05, P12, P15 | `P05-verification.md` | Covered at selection time. Re-pricing a persisted route is unproven: T10. |
| R10 | Run without Codex remaining open | P13 | none | **Not started.** P13-G1. |
| R11 | Deploy in local, server, and hybrid profiles | P14, P15 | none | **Not started.** P14-G1-G7. |
| R12 | Publish a reproducible, sanitized GitHub project | P00, P01, P17 | `P00-audit.md`, `P01-verification.md` | Covered to P01. Release bundle is P17. |

## Integrated Scenario Traceability

Scenario IDs and invariants are `Appx.B` verbatim. Verdicts are from a test-by-test
inspection on 2026-09-28, not from CI output.

| ID | Scenario | Verdict | Evidence | Gap or note |
| --- | --- | --- | --- | --- |
| T01 | Same job on three sources | partial | `tests/integration/discovery.test.ts:62`, `:207` | Merge needs an owner action. `packages/discovery/src/connectors.ts:86` keys requisition identity by `sourceKey`, so three boards cannot collapse unprompted. |
| T02 | Same title, distinct requisitions | covered | `tests/integration/repository.test.ts:64` | Two requisitions stay two identities. |
| T03 | Historical letter without receipt | covered | `tests/integration/discovery.test.ts:174` | `HISTORICAL_SUBMITTED`, excluded from confirmed. |
| T04 | Incompatible Dutch requirement | partial | `tests/unit/matching.test.ts:149` | Proven only via a missing English fact. No explicit-Dutch case, and no proof the gate precedes any inference reservation in `packages/inference/src/gateway.ts:262`. |
| T05 | Sponsorship unknown | partial | `tests/unit/matching.test.ts:160` | `futureSponsorship=yes` covered. `unknown` branches at `packages/matching/src/domain.ts:97,126` unexercised. |
| T06 | Salary crosses route threshold | partial | `tests/unit/matching.test.ts:149` | `pass` covered. `review`/`fail` and unit conversion at `packages/matching/src/domain.ts:65-86` untested. |
| T07 | Overlapping work periods | covered | `tests/unit/candidate.test.ts:64,72` | Set-union months plus a property test. |
| T08 | In-development project | covered | `tests/unit/documents.test.ts:73` | `DELIVERY_UPGRADED` blocks the packet. |
| T09 | Model invents a metric | covered | `tests/unit/letter-draft.test.ts:100` | Schema-valid proposal rejected `CLAIM_UNSUPPORTED`. |
| T10 | Pinned model becomes paid | partial | `tests/unit/matching.test.ts:122` | Rejection proven at selection. A stored `ready` route is trusted for 6 h without re-pricing (`MatchingRunner.route`/`assess`). |
| T11 | Privacy filters yield no route | covered | `tests/unit/inference.test.ts:54` | 404 becomes `MODEL_ROUTE_INELIGIBLE`; the allowlist is not relaxed. |
| T12 | Batch uses another company | partial | `tests/unit/letter-draft.test.ts:27,100` | Per-packet rejection proven. No batch layer exists, so "only the affected packet" is unproven. P12-G3. |
| T13 | Required field after upload | covered | `tests/unit/greenhouse-commit.test.ts:178` | Drift stops before permit acquisition, zero posts. |
| T14 | Selection succeeds, upload fails | covered | `tests/unit/greenhouse-fill.test.ts:185` | `upload_failed`, never READY. |
| T15 | Fake success banner | covered | `tests/e2e/mock-ats.spec.ts:186` | Banner shown, server record count 0, no CONFIRMED state. |
| T16 | Crash before click, after in-flight | covered | `tests/integration/durability.test.ts:18` | SIGKILL yields UNKNOWN plus reconcile work only. |
| T17 | Accepted, response lost | covered | `tests/integration/documents.test.ts:984` | One attempt, one receipt, no second final action. |
| T18 | Two workers race | covered | `tests/integration/concurrency.test.ts:45` | Four processes, one valid committing owner. |
| T19 | Revoked before click | covered | `tests/integration/documents.test.ts:898` | `LEASE_STALE`, no dispatch, no receipt. |
| T20 | Stop after request sent | partial | `tests/integration/repository.test.ts:206` | Task cancellation covered. Emergency-stop with a dispatched attempt (`Repository.setControl`, `repository.ts:106`) untested. P13-G5. |
| T21 | CAPTCHA interrupts one job | covered | `tests/e2e/mock-ats.spec.ts:159` | Unrelated work claimed during the handoff. |
| T22 | Owner submits during handoff | partial | `tests/e2e/handoff-broker.spec.ts:85`, `tests/integration/documents.test.ts:774` | Detection and refusal proven. Nothing writes a reconciliation record, and `browser-repository.ts:88` (`serverApplicationCount !== 0`) is untested. A4. |
| T23 | Account-created email | **missing** | - | No mail layer. Needs an evidence kind in `packages/contracts/src/submission.ts` and correlation in `SubmissionRepository.confirmReceipt`. P11-G3. |
| T24 | Verification link redirect | **missing** | - | No link validator. `commitSignup` `redirect:"error"` covers a POST, not an emailed link. P11-G5. |
| T25 | Clock and day boundary | partial | `tests/unit/domain.test.ts:33` | `localDay` math proven. No test advances the clock across a local day to show counters reset in `matching-repository.ts:114` and `candidate-repository.ts:574`, nor that records stay UTC. P13. |
| T26 | Restore older than submissions | **missing** | - | `restoreBlocked` is honoured at four read sites but has no writer and no test; `Repository.setControl` omits it by type. P15-G4. |
| T27 | Hybrid command replay | **missing** | - | No hybrid command model; config profiles are demo/local/server only. P14-G3. |
| T28 | Malicious JD asks for secrets | **missing** | - | Production guards exist (`gateway.ts` system prompt, `inferenceFacts`, `compileLetterProposal`) but are only exercised with benign text. Test-only gap. P15-01. |
| T29 | Job URL targets private network | partial | `tests/unit/discovery.test.ts:124,151` | Address classification and `recognizeUrl` proven. `readPublic` itself (`packages/discovery/src/transport.ts:48`) is never executed by a test. |
| T30 | Budget exhausted mid-day | partial | `tests/integration/matching.test.ts:99` | Reservation and durability proven. No test proves the route is not paused and that cached packets and queued submits continue. |
| T31 | Empty feed after drift | covered | `tests/integration/discovery.test.ts:97,124,140` | Count drop becomes a quality warning; no mass closure. |
| T32 | Session token expires | **missing** | - | `blocker:"login"` at `greenhouse-inspect.ts:107` is untested and maps to no account-exception state. Commit paths only classify 422 definitive, everything else unknown. A2 then P11. |

**Totals: 15 covered, 11 partial, 6 missing.** No missing scenario is claimed as
satisfied anywhere in this repository.

## Error Vocabulary Conformance

`Appx.A` requires 18 stable codes. All 18 are declared in
`packages/contracts/src/index.ts:47-75` and actively produced. Nine additional
codes are in use and are additive, not conflicting: `CONFIG_INVALID`,
`MIGRATION_UNSUPPORTED`, `STATE_INVALID`, `REVISION_STALE`, `NOT_FOUND`,
`TASK_CANCELLED`, `UNAUTHORIZED`, `ORIGIN_DENIED`, `RATE_LIMITED`.

Two namespace collisions are recorded rather than renamed, because both are
load-bearing in existing code: `CHALLENGE_REQUIRED` and `UPLOAD_FAILED` are both
`ErrorCode` members and also members of `ApplicationState` / upload-status enums;
`CLAIM_UNSUPPORTED` is both a thrown code and a document-validation finding code.
Conformance for this clause is complete.

## API Contract Conformance

`Appx.A` specifies 16 endpoints. 2 match exactly, 8 exist as domain-equivalent
variants under different paths, 6 are absent.

| Required | Status | Current equivalent |
| --- | --- | --- |
| `GET /v1/jobs` | absent | `GET /v1/discovery` |
| `POST /v1/jobs/import` | absent | `POST /v1/discovery/history` |
| `GET /v1/jobs/{id}/assessment` | variant | `POST /v1/matching/jobs/:id/assess` (write action, not a read) |
| `POST /v1/profiles/import` | variant | `POST /v1/candidate/sources` |
| `POST /v1/profiles/{id}/publish` | variant | `POST /v1/candidate/profile` |
| `GET /v1/authorizations/active` | variant | `GET /v1/candidate` plus `.../authorization/export` |
| `POST /v1/authorizations` | variant | `POST /v1/candidate/authorization` |
| `POST /v1/authorizations/{id}/revoke` | variant | `POST /v1/candidate/authorization/:id/revoke` |
| `POST /v1/applications/{id}/prepare` | absent | `POST /v1/documents/generate` |
| `POST /v1/applications/{id}/enqueue` | absent | none; enqueue is worker-internal |
| `GET /v1/applications/{id}/packet` | variant | `GET /v1/documents` |
| `GET /v1/applications/{id}/evidence` | absent | none |
| `POST /v1/exceptions/{id}/resolve` | absent | none; logic exists at `candidate-repository.ts:682,749` |
| `POST /v1/control/pause` | present | - |
| `POST /v1/control/stop` | present | - |
| `GET /v1/operations/summary` | present | - |

The current API is organised by bounded context rather than by resource. Aligning
it is Stage C work; the 41 registered routes are enumerated in
`docs/evidence/Stage0-conformance.md`.

## Event Envelope Conformance

`Appx.A` requires 13 envelope fields. 6 are present, 2 are renamed, 5 are absent,
and 1 is present but carries the wrong value.

| Required | State | Location |
| --- | --- | --- |
| `event_id` | present | `audit_events.id` |
| `schema_version` | **absent** | no column |
| `occurred_at` | present | `audit_events.occurred_at` |
| `owner_id` | present | `audit_events.owner_id` |
| `aggregate_type` | **absent** | inferred ad hoc from the action prefix |
| `aggregate_id` | present | `audit_events.aggregate_id` |
| `aggregate_revision` | present (renamed `revision`) | `audit_events.revision` |
| `event_type` | present (renamed `action`) | `audit_events.action`, unconstrained |
| `actor_type` | **absent** | collapsed into `actor` |
| `actor_id` | **absent** | collapsed into `actor` |
| `correlation_id` | **defective** | populated with `aggregate_id`, not a trace id |
| `causation_id` | **absent** | no occurrence in the codebase |
| `redacted_payload` | **unredacted** | `payload` is stored raw; only the logger redacts |

Enabling the envelope is Stage C work, because adding `aggregate_type`,
`schema_version` and `causation_id` requires a migration.

## Gate Status Summary

70 of 121 gates are complete. The 51 open gates break down as:

| Category | Count | Blocked by |
| --- | --- | --- |
| `blocked_external` in substance, coded `not_started` | 1 | P08-G6 needs a genuine private receipt |
| In-progress phase gates | 2 | P10-G6, P10-G7 |
| Not-yet-started phase gates | 42 | P11-P17 |
| Conformance gates added by this audit | 6 | T23, T24, T26, T27, T28, T32 |

The ledger records P08-G6 as `not_started` although its prerequisites are
external. The masterplan vocabulary in `Appx.D` distinguishes these: the
`blocked_external` status exists precisely so a gate awaiting a private
prerequisite is never confused with unstarted engineering. The ledger is migrated
to that vocabulary in the same stage as this audit.

## Gap Order

Ordered by the phase that must close each gap, with the earliest unblocked work
first.

1. **Stage A (P10 closeout)** - T22 reconciliation record, T32 login blocker to
   an account exception, plus the unscoped-answer defect at
   `document-repository.ts:63` and the missing rebuild path.
2. **Stage B (live route)** - P08-G6, and amendment 5 letter generation.
3. **Stage C (contracts)** - Appendix A endpoints, error-vocabulary coverage of the
   two collision names, event envelope migration, policy schema shape.
4. **Stage D (scenarios)** - T01, T04, T05, T06, T10, T20, T25, T29, T30, and the
   test-only T28.
5. **Stage E (P18)** - R01 breadth, R06 coverage, T12 batch layer is P12.
6. **Stages F-L** - T23, T24 (P11), T27 (P14), T26 (P15), R10 (P13), R11 (P14).

## Boundary

This audit is an inspection of code and tests, not a verification run. No test
was executed to produce it and no phase status changed as a result. Gate evidence
files named above were read and exist on disk; the single exception is recorded in
`docs/evidence/Stage0-conformance.md`, which also lists the 41 registered API
routes. No employer-facing request of any kind was made.
