# P13 Unattended Windows Autopilot and Throughput

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
This depends on P12's bounded runs and on P10's handoff checkpoint; the
open question is live ramp evidence, which needs genuine private receipts that
P08-G6 has never had.

## Decision Boundaries

- Do not require an editor, a terminal, or Codex to be open. The runtime must
  be launched by an owner-approved Windows mechanism and must outlive whatever
  started it.
- Keep the denominator honest. Masterplan chapter 02 requires every throughput
  number to state what it counts. An `UNKNOWN` outcome is never counted as
  submitted, a `needs_review` is never counted as confirmed, and a target
  shortfall must be explainable from measured stage counts.
- Use Europe/Amsterdam day boundaries everywhere, reusing `localDay` and
  `localDayStart` in `packages/domain/src/state.ts:56`. Do not hard-code a
  24-hour UTC window or an `Asia/...` default. Daily submission limit in
  `packages/persistence/src/candidate-repository.ts:574` and daily inference
  reservations in `packages/persistence/src/matching-repository.ts:114` must
  both roll over on the Amsterdam local day, including across the 29 March and
  25 October DST transitions.
- Persist timestamps in UTC. The local day is a derived presentation and
  rollover concept only, never a stored `day` column that can drift.
- Make emergency stop honest about its limit. It blocks new commits
  immediately. A request already sent cannot be recalled, per ADR-003, and the
  UI must say so rather than imply the in-flight action was undone.
- Fail closed across restart. A crash or restart may resume preparation. Any
  attempt in `IN_FLIGHT` goes to read-only reconciliation, never a replay, and
  no sleep, wake, or network-loss path may produce a second final action.
- Keep the runtime bounded. Queue depth, retry attempts, memory, disk, and live
  browser contexts must stay bounded; the 24-hour soak fails on unbounded
  growth rather than merely reporting it.
- Do not let scheduling create authority. Polling priority, daily target,
  browser concurrency limits, and quiet hours narrow work. None may bypass
  standing policy, and quiet hours suppress notifications, never reconciliation.
- Never report a synthetic or demo run as live throughput, and never label an
  adapter live-verified by volume.

## Implementation Order

1. Package the background runtime. Add a launcher in `apps/worker/src` with
   graceful shutdown that drains leases, crash restart with bounded backoff,
   heartbeats into the existing `workers` table, readiness and liveness
   reporting, and configuration migration on version change. Add an
   owner-approved Windows scheduled-task install script under `scripts/`.
   Prove in `tests/integration/worker-lifecycle.test.ts` that shutdown drains,
   that a killed worker restarts and re-claims only lease-expired preparation,
   that a stale heartbeat fails readiness, and that a future config version is
   refused rather than partially applied.
2. Implement scheduling and the day boundary. New scheduling module under
   `packages/domain/src` for source-specific polling, queue priorities, daily
   targets, browser concurrency limits, and quiet hours, all evaluated against
   `localDay` and `localDayStart`. Prove in `tests/integration/day-boundary.test.ts`
   by advancing an injected clock across consecutive Amsterdam local days and
   across both 2026 DST transitions, asserting the inference reservation count
   and the daily submission count each reset while every stored timestamp stays
   byte-identical.
3. Make control explicit. Extend `Repository.setControl`
   (`packages/persistence/src/repository.ts:95`) so emergency stop is a
   distinct state from pause, blocking new submit claims at
   `packages/persistence/src/repository.ts:358` and dispatch at
   `packages/persistence/src/submission-repository.ts:303`, while leaving an
   already-sent attempt in its honest `UNKNOWN` state. Prove in
   `tests/integration/emergency-stop.test.ts` with a dispatched attempt
   outstanding, and in `tests/e2e/operations.spec.ts` that the UI distinguishes
   stop from pause and names the recall limitation.
4. Build the operations readout. Extend the operations summary route in
   `apps/api/src/server.ts` and the matching view in `apps/web/src` to show
   actual stage counts, confirmed-evidence counts, unresolved ambiguity, the
   needs-help queue, next work, the model quota estimate from
   `MatchingRepository.snapshot`, and stop controls, with every count carrying
   its denominator. Prove in `tests/integration/api.test.ts` and
   `tests/e2e/operations.spec.ts` that an `UNKNOWN` attempt appears in none of
   the confirmed counts and that a shortfall is explained from measured stages.
5. Add a capacity harness. A synthetic-only driver under `scripts/` that
   replays a day of varied fit, model latency, account friction, portal errors,
   and challenges against the owned mock ATS, sampling queue depth, memory,
   retry counts, and browser contexts per hour. Prove bounded growth per class
   in `tests/integration/capacity.test.ts`, and assert in test that the harness
   refuses any target that is not the mock.
6. Run the 24-hour synthetic soak for real wall-clock time and record the
   measured series in `docs/evidence/P13-soak.md`, including quiescent memory,
   steady-state queue depth, and the reconciliation lag distribution. A
   compressed or simulated clock does not satisfy this increment.
7. Add the controlled live ramp behind an explicit owner switch: canary, then
   small batches, then toward the target, halting or isolating a route on any
   correctness regression such as an unexpected duplicate, a rise in
   unresolved ambiguity, or form drift. Every step records a real receipt. The
   ramp does not enable itself and is never represented as having run.

## Acceptance Mapping

- P13-G1 "Closing Codex does not stop the application runtime."
  `tests/integration/worker-lifecycle.test.ts` with the launcher started
  outside any editor session.
- P13-G2 "Restarting Windows or the worker resumes non-ambiguous work and
  reconciles in-flight attempts." `tests/integration/worker-lifecycle.test.ts`
  and the existing SIGKILL and lease-expiry coverage in
  `tests/integration/durability.test.ts`.
- P13-G3 "Sleep/wake and network-loss tests do not cause duplicate commits."
  `tests/integration/worker-lifecycle.test.ts` with an injected clock jump
  across a simulated suspend plus interface-down intervals, asserting the mock
  server record count never exceeds one.
- P13-G4 "A 24-hour synthetic soak shows no unbounded queue, memory, disk, or
  retry growth." `docs/evidence/P13-soak.md` from increment 6, backed by
  `tests/integration/capacity.test.ts` bounds.
- P13-G5 "Pause and emergency stop behave as documented, including the
  limitation for already-sent requests."
  `tests/integration/emergency-stop.test.ts` and
  `tests/e2e/operations.spec.ts`.
- P13-G6 "The dashboard can explain the target shortfall using measured
  counts." `tests/e2e/operations.spec.ts` against the extended operations
  summary, with each count carrying its denominator.
- P13-G7 "Live ramp evidence is genuine; reaching 50 is not a release claim
  unless actually observed." `docs/evidence/P13-ramp.md`, which is created only
  from real receipts. This gate stays open until then.

## External Gates

P13-G7 cannot be satisfied synthetically and is the phase's hard external
blocker. A live ramp needs a reviewed private profile, an active matching
standing authorization, appropriate current vacancies, and genuine private
receipts, which is the same unmet prerequisite as P08-G6. The 24-hour soak in
increment 6 is synthetic and must never be presented as ramp evidence. Genuine
sleep/wake behaviour also needs a real Windows host with real power and network
transitions; an injected clock proves the state machine, not the hardware.
Where the soak is run on a machine that cannot hold three days, it stays open
rather than being compressed.

## Traceability Gaps Closed

- T20, "Stop after request sent", recorded `partial`: task cancellation is
  covered at `tests/integration/repository.test.ts:206`, but emergency stop
  with a dispatched attempt was untested because `Repository.setControl` could
  not express it. Increment 3 closes that.
- T25, "Clock and day boundary", recorded `partial`: `localDay` math is proven
  at `tests/unit/domain.test.ts:33`, but nothing advanced the clock across a
  local day to show the counters in
  `packages/persistence/src/matching-repository.ts:114` and
  `packages/persistence/src/candidate-repository.ts:574` reset while records
  stay UTC. Increment 2 closes that.
- R10, "Run without Codex remaining open", recorded as not started with no
  evidence. Increments 1, 2, and 4 are the whole of R10.
- R07 support: restart reconciliation extends the existing unknown-outcome
  discipline to unattended operation. R02 support: the day-boundary and
  restart tests assert no duplicate work is generated.

## Out Of Scope

This phase does not build the server or hybrid profiles, does not add
multi-agent orchestration, does not change submission authority, and does not
relabel any adapter. It does not add CAPTCHA bypass, anti-bot evasion, proxy
rotation, or restricted logged-in scraping, and it never raises a throughput
claim from a synthetic soak. No employer endpoint is contacted by increments 1
through 6.
