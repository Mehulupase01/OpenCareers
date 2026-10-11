# P12 Minimized Node Gateway And Letter Review

2026-10-11. Synthetic transports, owned fixtures and local artifacts only.
P12 remains in progress; no live model quality, employer submission or phase
completion is claimed.

## Workflow

`createPreparationNodeHandler` connects fixed preparation proposals to the
authoritative inference ledger and transport. It verifies usable fact identity,
revision and career spans against locally held reviewed facts; excludes
identity, availability and immigration facts; minimizes contact/identity text;
bounds disclosure and output; validates route identity and actual reported
usage; and revalidates typed proposals before durable checkpointing. Critique
and repair spend their own allocations. Failed sent calls still consume quota.
Novel form questions are rejected under the current reviewed career policy,
whose approved purposes have not been broadened.

Transport cancellation now propagates through catalogue reads, endpoint reads
and completion POSTs, in addition to fixed transport timeouts. An expired run
cannot dispatch a late POST after catalogue validation. This cannot recall a
request already accepted upstream or refund its cost/quota.

`LetterDraftRunner.draftWithCritique` is the optional bounded letter workflow:
mandatory LLM draft, independent typed critique, at most one LLM repair, then
independent packet validation. Drafting, critique and repair each reserve their
own class. Two/three-request, token and wall-clock caps cannot widen. Repair is
compiled with the existing truthful-letter validator; critic approval fields
are rejected. Unknown answers and blocked packet claims stop the workflow.
The existing normal `draft` contract and sole real-letter drafting path remain
unchanged. No deterministic fallback was introduced.

Automatic matching now honors preparation pause, emergency stop and restore
quarantine before starting work and between vacancies. A pause cannot recall
an already-sent request. Graph storage caps active runs at six, expires
abandoned pure runs before admitting replacements and retains at most 1,000
terminal runs (plus up to six active runs) and 1,000 checkpoints per owner.
This does not replace whole-application audit/outbox retention or a real soak.

The successful synthetic workflow rendered five local artifacts using the
normal packet factory, including CV/letter PDF and DOCX format extraction and
validation. No attempt record or browser action was created. The graph and
review variant are not enabled in the worker by default; the explicit
`productionGraphEnabled` default is false and covered by tests.

## Verification

- Final frozen code check: 546 tests passed, 179 PostgreSQL skipped, 66 files.
  Lint, typecheck, ledger and build passed; existing any/chunk-size warnings
  remain. Final browser-helper edits separately passed lint and typecheck.
- Focused packet/gateway/letter suites: 29 passed, 11 PostgreSQL skipped.
  Covered incompatible facts, private facts, class accounting, overrun,
  cancellation, bad repairs, budget exhaustion and independent validation.
- Public-source scan passed 330 files; production dependency audit was clean.
- All 58 desktop/mobile browser tests passed after the quota and pause fixes.
  Successor CI run 38098680540 at `1f1ea9c264fc3c3e6309c212ba2643b63ab7a8ab`
  passed Windows, Ubuntu and PostgreSQL, including all 58 browser cases per lane.

## CI Correction

Foundation commit `bf12c8c0797ed159707d4f28f51d41e10f284912`, run
38097596542: PostgreSQL passed. Both Windows and Ubuntu passed their code
checks, but browser matching expected another eligible inference after earlier
scenarios consumed the five-request triage class. Each browser lane had 56
passes and two failed expectations. This was not dismissed as a flaky failure.

The matching browser test now accepts deferral only when the exact allocation
exhaustion reason, fixture route health and consumed quota are all evidenced.
Its successful path is retained. It also creates its own candidate and listing
when run alone. The shared listing fixture handles a scheduler/manual-poll
race by waiting for the already-running poll after its exact cadence rejection,
without retrying or bypassing source rate limits.

## Remaining

Complete measured task routing, held-out ablation and
production worker integration before phase closure. Default-off proposals do
not constitute deployed automatic graph coverage. P18 policy-bound hosted
preparation, source sessions/resumption, operational 20-source breadth and
remaining portal adapters stay open. Actual 24/72-hour soaks and independent
Windows/server installations have not been run. Private services were untouched.
