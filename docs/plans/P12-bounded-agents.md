# P12 Bounded Multi-Agent Orchestration and Cost Optimization

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
This depends on P11 closing the mail evidence gaps; the first genuine
submission P08-G6 and the owner OAuth client remain externally blocked and do
not gate this engineering.

## Decision Boundaries

- Do not build an open-ended agent framework. No tool-using loop, no
  autonomous goal decomposition, no self-selected sub-goals, no dynamic
  topology. ADR-006 defers general orchestration until measured requirements
  justify it, and this phase supplies a fixed typed node set instead.
- Never let a graph reach a final submission. A node must not receive a
  `CommitHandle`, must not call `SubmissionRepository.begin` or
  `authorizeDispatch`, and must not hold an application-state write. Replaying or
  resuming a graph cannot perform or repeat the final action.
- Keep the free-only firewall absolute. Every node call routes through
  `packages/inference/src/gateway.ts` with the same zero-price, allowlist,
  ZDR and no-data-collection checks applied at selection time. Routing may
  choose among allowlisted free routes; it may never relax a check, never
  enable fallback, and never accept a tiered or unparsed price.
- Respect the masterplan chapter 08 daily allocation of 50 requests: semantic
  triage 5, packet drafting 13, independent critique 13, novel form questions
  4, repairs 5, health probes 2, unallocated reserve 8. Enforce the
  `dailyLimit` bounds of 1 to 50 already validated in
  `packages/persistence/src/matching-repository.ts` and attribute every
  reservation to a node class. The 8-request unallocated reserve is never
  silently consumed by a low-value class.
- Bound every run. Steps, wall time, tokens, requests per node and requests per
  run are declared caps. Exceeding a cap fails the run; it never retries with a
  larger budget or silently widens.
- Keep model output as a proposal. Every node returns typed output revalidated
  in code, the same discipline as `parseStructured` and the exact-span
  requirement checks. A node cannot approve a claim, arm a submission, change
  an application state, or write a control.
- Checkpoint only pure preparation. Checkpoints carry graph, prompt and schema
  versions; incompatible versions are discarded and the pure step recomputed.
  A checkpoint may never contain a permit, an attempt, or partial external
  work. Anything that has touched a browser is not checkpointable.
- Batch only independent, similarly sized tasks that carry explicit item ids.
  Validate each item's result separately. Split on truncation, on a
  context-pressure threshold, or on any missing, duplicated or unrecognised
  item id. Never accept a short batch as complete.
- Quota exhaustion pauses inference only. Discovery, deterministic matching,
  cached packets and queued submissions continue, and exhaustion is never
  recorded as a successful or completed outcome.
- Do not silently re-enable the multi-agent path. It is off by default unless
  the ablation in increment 7 shows a declared improvement, and the fallback
  is the deterministic path, not a larger budget.

## Implementation Order

1. Define node contracts and migration v11. New `packages/contracts/src/agents.ts`
   for node kinds (extractor, match analyst, drafter, form-answer planner,
   critic, bounded repair), typed inputs and outputs, capability sets and a
   `GraphRunBudget`. Append to `packages/persistence/src/migrations.ts` the
   `graph_runs`, `graph_nodes`, `graph_checkpoints` and `agent_allocations`
   tables. Add `packages/persistence/src/graph-repository.ts` with
   owner-scoped run, node, checkpoint and allocation methods. Prove with
   `tests/unit/agent-contracts.test.ts` and
   `tests/integration/graph-repository.test.ts` on SQLite and PostgreSQL.
2. Build the bounded executor in `packages/inference/src/graph.ts` enforcing
   per-node and per-run caps and the chapter 08 allocation through
   `MatchingRepository.snapshot` and `reserve`. Exceeding a cap, exhausting a
   class allocation, or an unavailable route must fail the node without
   touching the run's other work. Prove in `tests/unit/graph-bounds.test.ts`
   and `tests/integration/allocation.test.ts` that the 50-request table is
   attributed per class, that a class cannot spend another's allocation, and
   that exhaustion leaves discovery and queued submits claimable.
3. Add routing across eligible free routes in `packages/inference/src/router.ts`,
   selecting by measured task quality, context need, health and latency, with
   price, privacy and capability re-verified per call rather than trusted from
   a cached catalogue or a previously stored `ready` route. Prove in
   `tests/unit/agent-routing.test.ts` that a manually pinned paid model, a
   tiered or unknown price, a paid tool request and a fallback-enabled route
   are all rejected, which extends the T10 re-pricing gap from selection to
   persisted use.
4. Implement checkpointing and resume keyed by graph, prompt and schema
   version, with explicit restart of incompatible pure preparation and a
   resumption path that reconstructs a run rather than a permit. Prove in
   `tests/integration/checkpoint.test.ts` with a worker kill mid-run, a resume
   onto a compatible version, and a version bump forcing a clean recompute of
   the pure step while leaving the attempt record untouched.
5. Implement batching in `packages/inference/src/batch.ts` for independent
   similarly sized items with required item ids, per-item validation, and split
   on truncation or context pressure. Prove in `tests/unit/batch.test.ts` that
   contamination, duplicate ids, missing items and truncated output are each
   detected, and in `tests/integration/batch-contamination.test.ts` that one
   bad employer in a batch does not alter the other packets.
6. Implement the critic and bounded repair nodes, with critique drawn from its
   own allocation class so it cannot cannibalise drafting, repair capped per
   node, and the independent validator in `packages/documents/src/validation.ts`
   re-run on every repaired proposal. Keep `LetterDraftRunner` in
   `packages/documents/src/letter-gateway.ts` as the sole letter-drafting path
   so the P06 amendment's no-silent-deterministic-fallback rule survives. Prove
   in `tests/unit/critic-repair.test.ts` and
   `tests/integration/agent-packet.test.ts`.
7. Run the ablation on the existing held-out set in
   `tests/fixtures/matching-evaluation.ts`, comparing deterministic and template
   baseline, single-model generation, and drafter-plus-critic on the same
   held-out jobs across claim errors, correction rate, latency and requests per
   accepted packet. Publish the measured numbers in
   `docs/evidence/P12-ablation.md` and keep the multi-agent path disabled by
   default unless a declared metric improves.

## Acceptance Mapping

- P12-G1 "Agent execution has bounded steps, time, tokens, and request
  count." `tests/unit/graph-bounds.test.ts` and
  `tests/integration/allocation.test.ts` against `GraphRunBudget`.
- P12-G2 "Graph replay cannot perform or repeat a final submission."
  `tests/integration/checkpoint.test.ts` combined with the absence of any
  commit handle in `packages/contracts/src/agents.ts`, and the unchanged
  interlock in `packages/persistence/src/submission-repository.ts`.
- P12-G3 "Batch contamination, duplicate IDs, missing items, and truncated
  output are detected." `tests/unit/batch.test.ts` and
  `tests/integration/batch-contamination.test.ts`.
- P12-G4 "Free-only routing remains enforced under fallback and manual model
  selection." `tests/unit/agent-routing.test.ts` plus the existing
  `packages/inference/src/gateway.ts` firewall suite in
  `tests/unit/inference.test.ts`.
- P12-G5 "The measured multi-agent variant improves a declared metric or is not
  enabled by default." `docs/evidence/P12-ablation.md` over the held-out set
  in `tests/fixtures/matching-evaluation.ts`, with the default flag asserted
  in test.
- P12-G6 "A 50-request simulation exhausts predictably, preserves reserve
  accounting, and defers work without falsifying success."
  `tests/integration/allocation.test.ts` driving the full chapter 08 table to
  exhaustion and asserting deferred work, not completed work.

## External Gates

No P12 gate requires an employer-facing action, so all seven are satisfiable
synthetically. One input is not: the measured quality and latency of a live
free route depend on the owner-supplied OpenRouter key and allowlists, which
`docs/evidence/P05-openrouter-live-route.md` records as still rate-limited and
unverified. Ablation numbers must therefore state whether each variant was
measured against a synthetic transport or a live free route, and must not be
presented as production latency. P08-G6 stays `blocked_external` and no agent
result changes that.

## Traceability Gaps Closed

- T12, "Batch uses another company", recorded `partial` because per-packet
  rejection is proven in `tests/unit/letter-draft.test.ts` but no batch layer
  exists, so "only the affected packet" is unproven. Increment 5 adds that layer
  and its contamination test.
- T30, "Budget exhausted mid-day", recorded `partial` because reservation and
  durability are proven in `tests/integration/matching.test.ts` but nothing
  proves the route is not paused or that cached packets and queued submits
  continue. Increments 2 and 6 add that proof against the existing
  `MODEL_QUOTA_EXHAUSTED` path in
  `packages/persistence/src/matching-repository.ts`.
- R09 hardening: free-only enforcement is now tested under fallback and manual
  selection, not only at route selection.
- R05 support: per-node claim validation extends the existing
  `CLAIM_UNSUPPORTED` behaviour to model-authored graph proposals.

## Out Of Scope

This phase does not add a general agent framework, memory or planning layer,
tool use, model self-selection, or any node able to arm or execute a
submission. It does not change the deterministic P06 letter path or the
real-adapter commit gate that rejects deterministic packets, does not attempt
P08-G6, and does not claim live model quality. No employer endpoint is
contacted.
