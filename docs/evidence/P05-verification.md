# P05 Verification: Free-only Inference And Evaluated Matching

Verification date: 2026-09-17

P05 adds a fail-closed free inference gateway, deterministic matching, immutable
assessment evidence, durable quota accounting, worker/API integration and an
owner-facing Matching workspace. It does not submit applications. A private
OpenRouter key was not present, so no authenticated live inference call is claimed.

## Implemented Surface

- Runtime configuration accepts an OpenRouter key only with explicit model and
  provider allowlists. Every model identifier must end in `:free`; demo mode rejects
  external keys.
- Catalogue routing checks freshness, every known price dimension, unknown fields,
  tiered overrides, context, modalities and strict structured-output support. It
  fixes one provider and disables fallback, tools and paid extensions.
- Requests contain only vacancy text and non-identity approved fact summaries. They
  set `zdr=true`, `data_collection=deny` and `require_parameters=true`. The API key,
  request content and response content are never persisted; only SHA-256 evidence is
  stored.
- Migration v5 adds bounded catalogue history, owner route state, atomic daily
  reservations and immutable profile-bound assessments on SQLite and PostgreSQL.
  Sent attempts remain counted; expired unsent reservations can be released.
- Eight code-owned gates cover vacancy state, duplicates, country, role, explicit
  language, salary, sponsorship and current work authorization. Stale profile-policy
  bindings fail closed. Hard failures score zero and never invoke inference.
- Structured proposals require exact source character spans and known candidate fact
  IDs. One bounded repair can remove a non-JSON envelope but cannot invent content.
  Code computes components and decides `auto_eligible`, `review` or `ineligible`.
- The protected API and worker expose route health without secrets. The responsive
  UI shows free budget, route evidence, outcomes, component scores, every gate,
  source quotes and fact identifiers. It labels scores as matches, not hiring
  probabilities.

## Frozen Evaluation

The corpus in `tests/fixtures/matching-evaluation.ts` was fixed before the salary
parser correction and retains the cases that exposed it. It has 72 synthetic cases:
20 strong matches, 44 hard disqualifiers and 8 targeted review cases. Twelve named
cases form the fixed holdout.

| Metric | Development plus holdout | Holdout |
| --- | ---: | ---: |
| Cases | 72 | 12 |
| Auto-eligible true positives | 20 | 3 |
| Auto-eligible false positives | 0 | 0 |
| Auto-eligible precision | 100% | 100% |
| Hard disqualifiers correctly blocked/reviewed | 44 / 44 | 6 / 6 |
| Unsupported candidate claims accepted | 0 | 0 |
| Label errors | 0 | 0 |

This is a curated regression result, not a universal accuracy or hiring-success
claim. Every case records required, preferred, role, location, evidence, certainty
and total score components. Representative holdout totals are 99.5 for a supported
strong match, 92 for an adjacent-role review, 55 for missing authorization evidence
and 0 for hard failures.

## Gate Evidence

| Gate | Evidence |
| --- | --- |
| P05-G1 paid pin rejected | `tests/unit/config.test.ts`, `tests/unit/matching.test.ts` |
| P05-G2 unknown pricing/tools rejected | `tests/unit/matching.test.ts`, `tests/unit/inference.test.ts` |
| P05-G3 concurrent/restart quota consistency | `tests/integration/matching.test.ts` on both databases |
| P05-G4 bounded 429, no identity rotation | inference transport and runner tests |
| P05-G5 unsupported claims rejected | exact-span and unknown-fact unit tests |
| P05-G6 holdout errors and components reported | frozen evaluation test and table above |
| P05-G7 unavailable route isolates inference | config, runner, API and worker integration tests |

## Verification Record

- Biome lint/format: pass, zero diagnostics.
- TypeScript typecheck: pass.
- Production web build: pass.
- Dependency audit: no known production vulnerabilities.
- SQLite/PostgreSQL matching repository and runner suite: pass.
- Full SQLite/PostgreSQL test suite: 15 files and 129 tests passed with zero skips
  under the required PostgreSQL setting.
- Desktop/mobile browser matrix: 8 workflows passed, including profile-bound policy,
  exact evidence rendering and viewport overflow checks.
- Browser screenshots: `docs/evidence/screenshots/P05-matching-desktop.png` and
  `docs/evidence/screenshots/P05-matching-mobile.png`.

## External Boundary

An unauthenticated read of the public model catalogue was used during planning only;
it did not send candidate data. Free model availability, provider privacy eligibility
and upstream quotas change over time, so production routes always require fresh
runtime evidence. Authenticated live inference remains externally pending until the
owner configures a private key plus explicit model/provider allowlists.
