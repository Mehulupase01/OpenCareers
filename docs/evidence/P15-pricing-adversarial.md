# Free-Only Adversarial Pricing

2026-10-13. Synthetic gateway/security evidence; no real model calls or billing test.

Review found that binary conversion accepted a positive string such as `1e-9999`
as zero. Numeric JSON also loses that coefficient during `JSON.parse`, so accepting
numeric zero cannot recover exact monetary evidence. Catalogue and reviewed endpoint
cost checks now require decimal strings with an all-zero coefficient, without
converting the coefficient to a floating-point number. Unknown/tiered/missing costs,
nonzero values, numeric costs, coercions, whitespace and malformed formats fail.
The reviewed endpoint's existing zero-valued numeric discount marker is retained;
it is not permitted as evidence for prompt/completion or other monetary cost fields.

This conservative format choice follows the decimal-string cost examples in the
[OpenRouter model catalogue](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
and [model endpoints](https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model)
references inspected on 2026-10-13. It is an application acceptance policy, not a
claim that every possible provider response has the same schema. A numeric-cost
variant is unsupported rather than silently treated as free.

The existing per-request fresh catalogue check remains mandatory before completion
POST, including persisted ready routes. Reviewed privacy uses endpoint-level evidence,
provider pinning and zero maximum prices. No request may add provider fallback, a paid
model pin, tools/plugins or relaxed privacy. Failures are explicit, not deterministic
letter fallback, hidden provider retries or final-action authority.

`tests/unit/pricing-adversarial.test.ts` covers all twelve recognized catalogue cost
dimensions, tiny positive decimal/scientific coefficients, enormous exponents,
numeric JSON underflow, nonfinite/coercible values, missing/tiered/unknown endpoint
costs and exact zero forms. Matching and mandatory-letter request builders each
complete once on a free route and refuse a newly repriced catalogue before a second
POST. `agent-routing.test.ts` separately refuses tools, fallback and manual paid
pins before catalogue access, stale/changed route evidence and policy overrides.

`tests/integration/node-gateway.test.ts` begins with the persisted free-ready route
and exercises all six typed node kinds plus the mandatory LetterDraftRunner with a
real OpenRouterTransport over a synthetic fetcher. Repricing produces only one
catalogue read, zero completion POSTs, a failed reservation and no attempt records.
The letter test seeds an actual synthetic application so reservation attribution is
enforced; it does not bypass the foreign-key contract.

Final focused pricing/route/privacy/matching/letter/node/batch/packet suite: 116
passed, 38 PostgreSQL cases skipped locally across ten files. Final pricing/native
full check: 808 passed /276 skipped, 105 files; lint/types/ledger/build pass. This
preceded the final bundle-list repair and missing-helper packaging regression.
Final bundle-specific suite: 23 passed /one Linux-specific case skipped. Corrected
production-only installed verification passed in 140.99 seconds, including compiled
native measurement. Final lint/types/build pass. These scopes are not summed into
an invented larger full-suite count. P15-G3 closes; P15 itself remains in progress.
CI 38330465431 at 7f63ba3 has passed PostgreSQL/server-image; Windows and Ubuntu were
still running at this checkpoint. The bundle repair needs successor CI. No live
model reliability, privacy review renewal or actual billing guarantee is claimed.

Successor full CI38332234815 at418d502 passes Windows/Ubuntu/PostgreSQL/server-image,
including final packaging and helper initialization changes. Windows810 passed /
276 skipped, clean installation1/1 in132.75s, desktop/mobile70/70. PostgreSQL is
verified in its separate lane; no live-provider reliability claim is added.
