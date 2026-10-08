# B1 Free Route Probe

Probed 2026-09-28 with the owner's rotated OpenRouter key, read through the
application's own configuration loader. The key is never printed, logged, or
written to this repository. Every request carried a single synthetic sentence
("Reply with the single word: ready") and no candidate content whatsoever, so the
probe proves provider eligibility without putting a single byte of private
profile data on a third party.

## What Was Asked

Two runtime invariants must hold together before any real inference is attempted:
zero price in both dimensions, and zero-data-retention provider eligibility with
data collection denied. The catalogue advertises price but not privacy, so
privacy eligibility is only discoverable by asking.

## Free Model Survey

The catalogue advertised 20 free models. All 20 were probed.

**Zero price and zero data retention: 3 routes.**

| Route | Structured outputs | Latency |
| --- | --- | --- |
| `apodex/apodex-1.1-mini:free` | no | 757 ms |
| `inclusionai/ling-3.0-flash-sante:free` | no | 705 ms |
| `openrouter/free` (free-model router) | no | 911 ms |

**Zero price and structured outputs: 4 routes.** `nvidia/nemotron-3-super-120b-a12b:free`,
`qwen/qwen3.8-27b:free`, `liquid/lfm-2.5-2.6b:free`, `dots-studio/dots-3-note-preview:free`.
**None of them is zero-data-retention eligible.** Each returned HTTP 404 with
"No endpoints found matching your data policy (Zero data retention)".

The two sets are disjoint. There is no free route that is both zero-priced and
zero-data-retention eligible and also advertises structured outputs.

## The NVIDIA Routes Specifically

Amendment 11 directed the use of any free OpenRouter model or NVIDIA Nemotron 3
Ultra. Probed directly:

| Route | Result |
| --- | --- |
| `nvidia/nemotron-3-super-120b-a12b:free` | HTTP 404, no ZDR endpoint |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | HTTP 404, no ZDR endpoint |
| `nvidia/nemotron-3.5-lightning:free` | HTTP 404, no ZDR endpoint |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | HTTP 404, no ZDR endpoint |
| `nvidia/nemotron-3.5-content-safety:free` | HTTP 404, no ZDR endpoint |

This is a provider property, not a configuration error, and it is now measured
rather than assumed. The earlier `404` recorded in the handoff was this same
condition, not a transient failure.

## The Previously Pinned Route Is Gone

`qwen/qwen3.8-27b:free` returned HTTP 404 with "This model is unavailable for
free. The paid version is available now". The free variant of the pinned model
has been retired. The repeated `429` and unavailable results recorded earlier were
this, not rate limiting. Any allowlist still naming it must be updated.

## What This Means For A Real LLM Letter

Owner amendment 5 requires an LLM-drafted cover letter for any real auto-submit
packet, and the central commit gate rejects a deterministic letter for external
adapters. So a real submission cannot be assembled until a route is available.

The masterplan Ch.08 rule applies directly: a strict no-training or
zero-data-retention choice may leave no free route available, in which case
model-dependent work pauses or uses approved deterministic content rather than
silently relaxing privacy. Privacy is not relaxed here and paid fallback stays
disabled.

Three viable paths exist, and the choice is the owner's:

1. **Prose-only drafting on a ZDR-capable free route.** Code selects the approved
   contribution IDs deterministically and binds them to facts; the model authors
   bounded prose; an independent validator checks every claim against those facts.
   Structured outputs are not required from the model, because the structured part
   is code-owned. This satisfies amendment 5 without relaxing privacy. The open risk
   is prose quality: these are small flash-class models, and quality on a real
   application is untested.
2. **Owner enables a ZDR-compatible provider on the OpenRouter account.** The
   error text points at the account privacy settings. That is an account-level
   choice and is not an application change.
3. **Accept that real submissions stay blocked.** Honest, but it means the product's
   central outcome, a genuine live submission, cannot be demonstrated.

## Boundary

No candidate fact, CV, packet, employer name, or receipt was sent to any provider
in this probe. The three ZDR-capable routes returned no usage cost. No paid route
was contacted. This is a route-eligibility measurement, not a quality evaluation:
no real candidate content has been sent through any route, and no live submission
has been made.