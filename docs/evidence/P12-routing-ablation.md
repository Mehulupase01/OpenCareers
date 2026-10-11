# P12 Routing And Ablation Milestone

2026-10-11. Synthetic verification only. No live inference, employer action,
private profile import or deployed database migration occurred.

## Routing And Admission

Migration 17 adds bounded inference observations to the existing authoritative
reservation ledger. Completion and observation are atomic, owner/task-scoped,
and retained to the latest 2,000 observations. Samples older than 30 days are
excluded. No prompts, career text or secrets are stored in observations.

The matching catalogue-refresh path considers only allowlisted, free,
context-capable, privacy-compatible routes. Owner order is preserved unless
every remaining candidate has at least five samples. It then ranks validated
completion acceptance before median latency. Three consecutive rejected
results suspend a candidate for 15 minutes. No healthy candidate means pause,
not paid fallback. Existing six-hour catalogue caching remains; this is not
per-call adaptive routing. Every actual completion still independently checks
fresh free-price and provider evidence before POST.

Matching validates source spans and career evidence before recording successful
completion. Unsupported claims record failure and cannot improve ranking.
Acceptance measures protocol/evidence validation, not hiring probability or
semantic accuracy against human labels. Letter and pure-node tasks also record
observations, but automatic task-specific selection for those classes is not
yet registered in the worker.

Pure-node and reviewed-letter requests now reserve output room using serialized
UTF-8 input bytes plus a 1,024-unit framing margin before allocating quota.
This is conservative admission, not an exact tokenizer or a billing guarantee.
Reported usage overrun still fails after a sent request and consumes quota.
Transport checks context room including output allowance. Invalid output caps
cannot be sent. Oversized node prompts fail before reservation or transport.

Quota exhaustion defers remaining independent batch work. Rate limiting or an
unavailable route also defers the batch after one dispatch, without splitting
and repeatedly calling the unavailable service. Malformed result envelopes
still split within fixed bounds; contamination still quarantines individual
items. Pure-node rate limiting records the ordinary two-minute backoff.

## Held-Out Comparison

Reproduce with `corepack pnpm exec tsx scripts/evaluate-p12.ts`. It uses only
fresh in-memory synthetic databases, known synthetic career facts and fake
structured model responses. It reads no `.env` and makes no network calls.

Holdout: 12 jobs; routing errors: zero; packet-eligible jobs: three.
Holdout SHA-256:
`e07b04327e0b643050263c58146fb3296139858fbf421078b54f60fade8821f8`.

| Variant | Accepted | Claim errors | Corrections | Requests | Requests/accepted | Median local preparation ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Template baseline | 3 | 0 | 0 | 0 | 0 | 0.186 |
| Single model | 3 | 0 | 0 | 3 | 1 | 1.898 |
| Drafter + critic | 3 | 0 | 0 | 6 | 2 | 3.208 |

These are fixture transport results and machine-specific local processing
times, not real model quality, network latency or document-render timings.
The three eligible jobs are simple and the synthetic responses are valid;
there is no error headroom here. No hiring-accuracy improvement is established.
Critique doubled requests without measured claim/correction gain, so the
multi-agent variant remains disabled by default. Real applications still
require LLM letters; the synthetic template baseline is not a fallback.

## Verification And Boundaries

Full local suite: 558 passed, 181 PostgreSQL skipped, 67 files. The subsequent
matching validation regression passes all 11 SQLite cases (11 PostgreSQL cases
await CI). Production build passes. Final milestone lint, typecheck, ledger,
public scan, dependency audit and remote results are recorded in the handoff.

Prior commit `1f1ea9c264fc3c3e6309c212ba2643b63ab7a8ab` is green in CI run
38098680540 on Windows, Ubuntu and PostgreSQL, including all 58 browser cases
in each browser lane. That verifies graph replay isolation, checkpoint recovery,
batch integrity, free-only transport and allocation simulations. P12-G2/G3/G4/G6
close on that evidence; this document's new routing/ablation work is a separate
milestone. P12 stays open: production orchestration and task-specific batch/
routing integration remain. Real receipts, consent, installations and actual
24/72-hour soaks remain separate unfinished requirements.
