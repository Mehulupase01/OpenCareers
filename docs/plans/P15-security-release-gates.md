# P15 Security, Fault Injection, Restore, and Release Gates

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
This depends on P14's server and hybrid profiles and on P13's unattended
runtime; the 72-hour soak and any live-adapter claim remain externally or
wall-clock blocked.

## Decision Boundaries

- Fail closed, always. There is no degraded submission path, no partial
  commit, and no "probably fine" branch in any of the scenarios exercised here.
- Never replay the final click. An unknown external outcome is reconciled
  read-only. Lease expiry, crash, redelivery, and receipt-write failure all
  resolve to reconciliation work, never to a fresh submit task.
- Do not weaken the commit interlock. `restoreBlocked`, `stopped`,
  `submissionsPaused`, and authorization checks stay in the same transaction
  that grants dispatch authority, as they are at
  `packages/persistence/src/submission-repository.ts:303`.
- Give `restoreBlocked` a real writer. It is honoured on the read path at
  `packages/persistence/src/repository.ts:358`,
  `packages/persistence/src/repository.ts:413`,
  `packages/persistence/src/submission-repository.ts:303`,
  `packages/persistence/src/discovery-repository.ts:226`, and
  `packages/persistence/src/discovery-repository.ts:254`, but
  `Repository.setControl` at `packages/persistence/src/repository.ts:95` omits
  it by type, so nothing can ever set it. This phase adds that writer and its
  test.
- Keep the free-only firewall total, including under a persisted route that has
  since become paid. A stored `ready` route trusted for its window without
  re-pricing is exactly the gap T10 records.
- Treat every external input as hostile: job descriptions, employer emails,
  document payloads, imported URLs, and model output. None may widen
  execution authority, disclose a secret, or induce an SSRF.
- Do not add a general sandbox, container-per-task runtime, or egress
  filtering layer. Controls are in the existing gateway, validator, and
  transport boundaries, plus the network policy already proven in P07.
- Use exact pinned versions and keep `pnpm-lock.yaml` current. An unpinned
  action reference or an unpinned runtime is a release blocker.
- Never claim a live adapter. Fixture-tested and live-verified are different
  support levels and every evidence file states which one was observed.
- Do not treat a soak as a substitute for a fault test, or a fault test as a
  substitute for a soak. Each gate names its own artifact.

## Implementation Order

1. Threat model and adversarial input suite. Write
   `tests/security/prompt-injection.test.ts` covering malicious job
   descriptions, employer emails, and model-output attempts to widen authority,
   asserting that the `packages/inference/src/gateway.ts` system prompt, the
   `inferenceFacts` minimizer, and `compileLetterProposal` in
   `packages/documents/src/letter-draft.ts` all refuse. Extend
   `tests/unit/discovery.test.ts` so `readPublic` in
   `packages/discovery/src/transport.ts:48` is actually executed, asserting
   refusal of loopback, link-local, RFC1918, and redirect-to-private targets.
2. Crash matrix. New `tests/security/crash-matrix.test.ts` driving SIGKILL,
   worker duplication, lease expiry, queue redelivery, network partition, and
   disk-full at every commit boundary, asserting exactly one mock ATS server
   record and that every survivor is `needs_review` rather than resubmitted.
3. Restore drill and the `restoreBlocked` writer. New migration adding the
   recovery-run table and the audited control-set path, with the write performed
   only by an owner-authenticated restore operation. Prove in
   `tests/integration/restore-drill.test.ts` that a database older than a set
   of external applications restores with commits disabled at every read site,
   then that an owner decision re-enables commits only after reconciliation,
   and that the decision is audited with its actor and reason.
4. Backup, restore, rekey, and rotation drills. Prove in
   `tests/integration/backup-restore.test.ts` that a backup restores to a
   consistent database with matching artifact checksums on both SQLite and
   PostgreSQL, that a vault rekey preserves decryptability of live material
   while invalidating the old key, and that credential rotation and
   authorization revocation take effect at the next commit gate.
5. Free-only adversarial pricing suite. New
   `tests/security/pricing-adversarial.test.ts` asserting rejection of paid,
   tiered, unknown-dimension, and unpriced routes, of a paid tool request, and
   of a route that became paid after persistence, plus a re-pricing check on
   every agent and letter dispatch path in P12 and the P06 amendment.
6. Supply chain. Generate an SBOM, pin remaining CI action references, run the
   production dependency audit and the public-source credential scan in
   `scripts/public-scan.ts` over release artifacts, and record the provenance of
   copied upstream code. Record the exact commands and results in
   `docs/evidence/P15-supply-chain.md`.
7. Run the 72-hour synthetic soak with injected outages, quota resets, and
   portal errors, measuring resource bounds, reconciliation lag, queue
   fairness, and parser-drift response, and record the measured series in
   `docs/evidence/P15-soak.md`.

## Acceptance Mapping

- P15-G1 "No critical unresolved finding can permit unauthorized submission,
  secret disclosure, wrong-owner access, or blind duplicate replay."
  `tests/security/prompt-injection.test.ts`,
  `tests/integration/restore-drill.test.ts`, and the owner-isolation coverage
  in `tests/integration/accounts.test.ts` and
  `tests/integration/handoff.test.ts`.
- P15-G2 "Zero duplicate external records occur in the supported mock crash
  suite; unresolved outcomes are retained honestly."
  `tests/security/crash-matrix.test.ts`, asserting mock server record counts
  after each fault.
- P15-G3 "All free-only adversarial pricing/fallback tests pass."
  `tests/security/pricing-adversarial.test.ts`.
- P15-G4 "A restored system remains commit-disabled until the
  external-submission gap is reconciled."
  `tests/integration/restore-drill.test.ts` against the new `restoreBlocked`
  writer.
- P15-G5 "Backup restoration verifies database consistency and artifact
  checksums." `tests/integration/backup-restore.test.ts` on SQLite and
  PostgreSQL.
- P15-G6 "The 72-hour synthetic soak completes with bounded resource usage and
  no silently lost tasks." `docs/evidence/P15-soak.md`.
- P15-G7 "Real adapter claims are limited to the tested variants and dates."
  `docs/evidence/P15-security-gate.md` restating the support matrix in
  `docs/adapter-support.md` with observed dates and no unsupported label.

## External Gates

P15-G6 is a 72-hour wall-clock soak against the mock ATS. It cannot be
compressed, simulated, or back-filled, so this gate is open from the moment
the phase starts until a real run completes and the measured series are
recorded. P15-G7 depends on live receipt evidence that does not exist in this
repository, so no adapter may be labelled live-verified here; the mock, the
read-only Greenhouse inspection, and the Recruitee API adapter stay at their
current support levels. No part of this phase may contact a real employer
system.

## Traceability Gaps Closed

- T26, "Restore older than submissions", recorded `missing` because
  `restoreBlocked` had no writer and no test. Increments 3 and 4 close it.
- T28, "Malicious JD asks for secrets", recorded `missing` as a test-only gap;
  the production guards already existed but were exercised with benign text
  only. Increment 1 closes it.
- T29, "Job URL targets private network", recorded `partial` because address
  classification and `recognizeUrl` are proven while
  `packages/discovery/src/transport.ts:48` `readPublic` is never executed by a
  test. Increment 1 closes it.
- R09, "Prevent paid inference in free-only mode", re-proven under adversarial
  pricing and re-pricing.
- R07, "Recover ambiguous submissions without blind replay", re-proven across
  the full crash matrix.
- R02, "Avoid duplicate applications across sources and restarts", extended
  across restore, which was previously unexamined.

## Out Of Scope

This phase does not add new adapters, does not implement P16 outcomes or
calibration, does not build the P17 release bundle, and does not introduce a
sandbox or egress proxy. It does not attempt P08-G6, does not perform any
employer-facing request, and does not perform a real live receipt. No gate here
is closed by a synthetic stand-in for a real soak or a real receipt.
