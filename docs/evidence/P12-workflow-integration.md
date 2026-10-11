# P12 Workflow Integration

2026-10-11. Synthetic code/workflow evidence, not live model quality or an
employer receipt. Supersedes the integration gaps recorded in earlier P12
milestones; automatic generic graph/batch execution remains disabled by design.

## Delivered Scope

The fixed six-node executor has strict proposal-only contracts, minimized
ledger-backed handlers, cancellation, version-bound durable checkpoints and
owner-isolated retention. Killed-worker replay preserves an existing UNKNOWN
attempt. Graph code has no permit, browser session, CommitHandle or final-action
capability. The guarded deterministic submission engine remains sole authority.

`createPreparationBatchDispatch` connects the isolation engine to the same
production transport and quota ledger. It sends similarly sized independent
items in one strict ID envelope, minimizes each item's reviewed facts, bounds
requests and total declared/reported usage, and validates results against each
original item. Missing/duplicate identities and truncation cause bounded splits;
cross-item career evidence quarantines the affected item, not its valid peer.
Rejected envelopes are failed ledger outcomes. Unknown usage consumes its whole
allowance; overrun closes the dispatch budget. Quota or route failure defers
remaining work without retry amplification. No application state is written.

Task-class route selection is now persisted in the existing inference state.
Switching from triage to drafting, critique or repair reselects against that
class's measured acceptance/latency samples. Repeating the same class respects
the existing six-hour catalogue cache; 429 backoff is not bypassed. Letter,
node and batch gateways can invoke the typed route selector before reservation.
The production worker wires it into ordinary mandatory LLM letters and optional
review. Fresh per-completion price/privacy/context validation remains mandatory.
Concurrent route changes can invalidate unsent reviewed reservations; they fail
closed rather than relax the model/provider binding. No second quota store.

`draftWorkerLetter` is the worker's tested policy boundary. Private preparation
requires a working LLM runner and propagates its failure. It never substitutes a
template. `AUTOPILOT_LETTER_REVIEW=true` explicitly opts a configured private
profile into at most three requests, 8,000 declared/reported tokens and 120
seconds for draft/independent critique/one repair. This flag defaults to false
and is rejected in demo or without configured private inference. Review still
requires independent packet validation before ordinary artifact persistence.

The generic graph/batch services are implemented and transport-integrated but
not automatically dispatched by the normal worker. The measured fixture
ablation found no quality gain from the more expensive variant, so normal
production operation deliberately retains single-model letters. This is a
default-off optimization decision, not enabled universal agent coverage.
Template generation remains synthetic-only. Review/proposal agents never gain
final-submission authority through the opt-in.

## Acceptance Map

- P12-01: contracts, executor and minimized node gateway; unit/integration agent
  preparation, node gateway and packet suites.
- P12-02: graph repository and actual killed-worker checkpoint recovery; already
  verified in CI 38098680540.
- P12-03: batch engine plus ledger-backed dispatcher; batch unit tests and
  `tests/integration/batch-gateway.test.ts`.
- P12-04: measured route selection, bounded observations and production letter
  task selector; agent-routing, matching and letter-draft tests. Acceptance is
  evidence/protocol validation, not human-labelled matching accuracy.
- P12-05: frozen 12-job synthetic holdout, three eligible packets, declared
  request/claim/correction metrics and default-off decision; reproducible
  `scripts/evaluate-p12.ts`, not a live-model benchmark.

All six safety/default-off gates now have green cross-platform evidence from
the two preceding milestones, including run 38100030249 at
`ec192530569cbc4e8e9b114743589b56d18cdca5`. The newer workflow integration
tickets and phase remain verification-pending. Focused routing/runtime verification:
71 passed, 19 PostgreSQL skipped, seven files. Full milestone results and
phase closure are recorded only after actual verification in the handoff.

## Production Boundaries

This phase does not assert improved real hiring accuracy, live model reliability,
genuine submissions, 20 operational sources, universal portal coverage, startup
installation, a server deployment or completed soaks. P08 private receipt and
remaining P13-P18 requirements are separate. Actual privacy disclosure remains
within the reviewed career-facts purpose; novel form-question inference is still
rejected under that reviewed policy. Private keys, CVs, authorizations and
services were untouched by these synthetic tests.
