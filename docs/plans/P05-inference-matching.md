# P05 Free-only Inference And Evaluated Matching

Plan prepared 2026-09-17 from masterplan page 34 after P04 closure. A real
OpenRouter key is optional for engineering and is not present in public fixtures.
No model output can grant submission authority or introduce a candidate fact.

## Decisions

- Implement one inference gateway around a narrow transport interface. Production
  transport uses only `https://openrouter.ai/api/v1`; tests use an injected fixture.
  API keys stay in process configuration, are never persisted or returned, and are
  redacted from errors and request metadata.
- Discover the current model catalogue before routing. A route is eligible only when
  every expected price dimension is present, numeric and exactly zero, no unknown
  price dimension exists, text input/output and strict structured responses are
  supported, context is sufficient, health evidence is fresh, and the model is on
  the owner policy allowlist. Unknown catalogue data fails closed.
- Send no tools. Reject tool configuration before quota reservation or transport.
  Requests set `provider.zdr=true`, `data_collection=deny`,
  `require_parameters=true`, `allow_fallbacks=false` and an explicit provider/model
  route. OpenRouter account settings remain an independent prerequisite, not an
  assumption made from request fields.
- Use a durable daily quota ledger with atomic reserve, complete and release states.
  The configured free-request ceiling is a local upper bound, not a promise that an
  upstream quota is available. Restarts retain reservations; expired reservations
  are reconciled conservatively. A 429 records bounded backoff and never rotates
  accounts, keys, providers or network identity.
- Run deterministic gates first: open/fresh canonical vacancy, duplicate/history,
  allowed country/location/workplace, explicit language, salary feasibility and
  exact sponsorship restrictions. Unknown or contradictory material facts create a
  targeted review outcome. Obvious rejects and accepts do not require inference.
- Minimize inference input to the vacancy title/description plus approved fact IDs
  and short evidence summaries. Structured output may identify requirements, exact
  job-description spans, fact mappings, gaps and uncertainty. Validation rejects
  unknown IDs, non-matching spans, unsupported claims, inconsistent numeric values
  and extra fields. One bounded repair may fix syntax only; it cannot add evidence.
- Compute score and eligibility in code from validated components. Persist the
  catalogue snapshot, policy revision, profile revision, prompt/schema version,
  model/provider route, redacted hashes, component scores and explanations. Model
  prose is untrusted proposal data and cannot directly transition an application.
- Add an owner-facing Matching workspace with route health, daily reservation use,
  deterministic/model status, component explanations, exact evidence links and
  pause reasons. Discovery remains usable when inference is unavailable.

## Evaluation Protocol

- Commit at least 50 synthetic labeled cases before tuning. Cover strong matches,
  adjacent roles, hard location/language/sponsorship/salary exclusions, uncertain
  sponsorship, seniority mismatch, misleading titles, unsupported metrics and
  malformed model outputs.
- Mark a fixed holdout subset in data and compute it separately. Never remove hard
  examples after a failure. Record sample size, confusion counts, auto-eligible
  precision, hard-disqualifier routing, unsupported-claim count and per-case score
  components. Do not present the result as a universal accuracy rate.
- Required threshold: every curated hard disqualifier is blocked or routed to review,
  at least 90 percent precision among auto-eligible fixture predictions, and zero
  invented candidate facts. A miss tightens the eligibility boundary or changes the
  implementation; it does not relabel the fixture.

## Implementation Order

1. Add strict gateway/catalogue/request/response and deterministic assessment
   contracts, configuration and redaction helpers.
2. Add migration v5 for inference policy, catalogue health, daily reservations,
   request attempts and immutable assessments. Prove SQLite/PostgreSQL concurrency,
   restart recovery, owner isolation and populated upgrade behavior.
3. Implement deterministic gates and evidence-bound semantic validation, then the
   code-owned weighted score and application transition policy.
4. Implement the bounded OpenRouter transport, model refresh, strict routing,
   timeout/429 behavior and fixture worker. Keep deterministic work independent.
5. Add 50+ frozen synthetic evaluation cases, report generation and adversarial
   schema/claim tests. Establish the holdout before tuning.
6. Add protected API and responsive Matching workspace, then run desktop/mobile,
   build, audit, public scan and CI. If a private key is available, run one redacted
   live free-route probe; otherwise record live reliability as externally pending.

## Gates

Paid or unknown-price routes and paid tools fail before inference; concurrent quota
reservation survives restarts; 429 handling is bounded without identity rotation;
schema-valid unsupported claims fail evidence validation; the report includes holdout
errors and score explanations; and missing free capacity pauses only inference.

## Current OpenRouter References

- [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [Structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Zero data retention](https://openrouter.ai/docs/guides/features/zdr)
- [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

OpenRouter catalogue, prices, free capacity, quotas and provider privacy can change.
Runtime evidence therefore expires and must be refreshed; this plan makes no durable
claim that a currently free route will remain available or reliable.
