# Reviewed Inference Policy

2026-10-09. Implements execution-order step 4 under the owner's earlier chat
approval to allow a reviewed free provider to process minimized career facts.
This is not a new completed masterplan phase or live model-quality certification.

## Review And Controls

The explicit revision `reviewed-career-facts-v1` allows only Novita serving
`apodex/apodex-1.1-mini:free`, for matching and letter proposals. Its review expires
2026-11-08. Source URLs, fetched HTML SHA-256 hashes, dates and constraints are
pinned in `packages/inference/src/privacy.ts`. Renewing it requires a new review,
not an automatic extension. Strict ZDR remains the default for all profiles.

[Novita terms](https://novita.ai/legal/terms-of-service), updated 2026-08-05,
section 10.2 excludes content training and service improvement by default, with
retention exceptions for service provision, legal requirements and support.
[Novita privacy policy](https://novita.ai/legal/privacy-policy), updated 2026-05-13,
excludes personal-information training and describes longer technical/account
metadata retention. Neither is treated as an unconditional zero-retention promise.

[OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
documents the controls used here: one provider, no fallbacks, required parameters,
explicit data-collection allowance for this revision, and zero prompt/completion/
request/image price ceilings. Account-wide restrictions can still deny the route;
the app never changes account settings or retries with weaker controls.

Every refresh verifies the model catalogue and its actual provider endpoint:
matching model/provider, available status, context, strict structured output and
explicit zero prices. Unknown price dimensions fail closed. Evidence is persisted
in the existing authoritative database; the policy hash is audited. Cached routes
are invalidated when the review changes; expired/future reviews and stale/future
endpoint evidence refuse both matching and letter calls. The transport independently
checks request privacy controls before HTTP. Failures have no paid/model/provider
fallback. Quota reservation and the sent marker recheck the current policy/model/
provider under the owner transaction; changed policies and expired reservations
cannot authorize disclosure. The sent marker audits the policy binding and a hash,
never the prompt. Existing durable quota accounting includes failed sent requests.

## Disclosure Boundary

The existing typed career-fact summaries and approved letter contributions remain
the only candidate evidence; no raw CV, source provenance, identity object,
authorization object, approved answer bank, mailbox, cookies or credentials is sent.
Reviewed matching also excludes availability facts. Known identity values and
name parts, contact addresses, links, local paths, token-shaped text and immigration
sentences are space-redacted from vacancy/evidence text. This preserves vacancy
character offsets for local quote validation. Evidence IDs/openings that disclose
known identity fail closed. Matching payloads have a 24 KB disclosure limit;
letters retain their bounded descriptions and evidence selection.

These are structured minimization plus defensive redaction, not a guarantee that
arbitrary prose is anonymous. Only reviewed canonical career evidence belongs in
these fields. Local evidence validation, mandatory LLM letter generation, immutable
document storage and dispatch guards remain in force. The model has no action tools.

## Configuration And Verification

After the coordinated private-runtime/schema rollout, set these nonsecret values
alongside the existing private key:

```dotenv
AUTOPILOT_INFERENCE_PRIVACY_REVISION=reviewed-career-facts-v1
AUTOPILOT_OPENROUTER_MODEL_ALLOWLIST=apodex/apodex-1.1-mini:free
AUTOPILOT_OPENROUTER_PROVIDER_ALLOWLIST=novita
```

This change does not modify the owner's `.env`, rotate keys, migrate private data,
restart existing processes or invoke a live model. Production activation and a
private receipt-backed application remain separate requirements.

Synthetic unit tests cover default strict controls, unknown/expired review refusal,
freshness, endpoint capability/pricing/provider failures, matching/letter minimization
and transport refusal before HTTP. SQLite/PostgreSQL integration cases cover
policy-change cache replacement, durable audit/quota state and failed endpoint
parking without repeated polling or completion calls. Cross-platform verification
is recorded in HANDOFF once its actual result is known.

## Model Availability

Public catalogue and endpoint checks on 2026-10-09 confirmed Novita's explicit free
structured-output route. This does not certify output quality or future availability.
Nemotron Ultra currently lacks advertised strict structured outputs. OpenRouter's
[NVIDIA provider page](https://openrouter.ai/provider/nvidia) links
[trial terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)
restricting production and personal-data use. Those limits were not silently waived.
Evaluated quality, routing alternatives and live availability remain release work.
