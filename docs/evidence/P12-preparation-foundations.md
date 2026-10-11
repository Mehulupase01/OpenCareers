# P12 Preparation Foundations

2026-10-11. Synthetic evidence only; no employer-facing action or live inference.
P12 remains open. This is a verified foundation milestone, not completed agent
workflow integration or a claim about production model quality.

## Implemented

- Six fixed, strict preparation node contracts. No browser, tool, permit,
  submission handle or application mutation is part of their input/output.
- Migration 16 appends owner-scoped graph runs, nodes and checkpoints. Earlier
  migration checksums are unchanged. Task allocations use the existing
  inference reservations instead of a second authoritative quota ledger.
- Daily 50-request allocation: triage 5, drafting 13, critique 13, form
  questions 4, repairs 5, health 2, reserve 8. Routine work cannot borrow
  another class or spend the reserve. Lower owner limits protect a proportional
  floor reserve. Legacy rows still count against the global limit.
- Sent and failed requests consume quota. Only unsent reservations can be
  released; expired reservations cannot be marked sent. Mandatory letters
  reserve the drafting class; existing matching reserves triage.
- A pure executor bounds topology, steps, time, declared tokens and requests.
  Inputs are cloned for handlers; typed output is revalidated against original
  evidence. Deadline/usage overruns cannot checkpoint late results.
- Checkpoints bind graph, prompt, schema, profile, policy and input versions,
  validate output integrity, isolate owners and retain at most 1,000 entries.
  A replacement run gets a fresh ID; incompatible work is recomputed.
- Independent batches require exact item identities, isolate contaminated
  output and split missing, duplicate, unknown and truncated results within
  fixed call/context/time caps. Deferred items are not successful items.
- Production matching and letter transports receive explicit allowlists.
  Every completion re-fetches catalogue evidence and, for the reviewed
  career-facts policy, provider endpoint evidence. Paid, tiered, unknown or
  uninterpretable prices, tools, fallback and privacy relaxation fail closed.
  Completion without an explicit policy is disabled. Missing/noninteger usage
  and non-stop finish statuses are rejected.

## Verification

- Final frozen `pnpm check`: 531 passed, 165 PostgreSQL cases skipped, 64 test
  files; lint/typecheck/ledger/build passed. Existing any/chunk-size warnings
  remain. Public-source scan passed 326 files and production audit was clean.
- Final focused nine-file verification: 74 passed, 18 PostgreSQL cases skipped.
  Includes route repricing, 50-request allocation, concurrency, corruption,
  handler mutation, node/run limits, letter allocation and privacy controls.
- `tests/integration/graph-checkpoint.test.ts` kills an actual synthetic worker
  after durable checkpointing. Compatible work is reused, a schema change
  recomputes it, and an existing UNKNOWN attempt is byte-for-byte unchanged.
- PostgreSQL and frozen all-file results must be recorded from subsequent CI.

## Remaining P12 Work

The graph and batch primitives are not registered in the production worker.
Handlers are trusted pure code, not arbitrary model-authored programs; reported
usage is checked after execution and cannot by itself cancel an upstream bill.
Real node handlers must use the ledger, reviewed minimization and transport,
and honor cancellation before any external call. No general-purpose agent is
enabled. There is no deterministic fallback for real LLM letters.

Finish actual matching/packet integration, independent critique and bounded
repair with final packet validation, measured task-quality/latency routing,
held-out ablation and graph-run retention before closing P12. Do not treat
synthetic transport quality or latency as live-model performance. P08 receipts,
Gmail consent, Windows installation and 24/72-hour soaks remain separate gates.
Private installations were not migrated or restarted.
