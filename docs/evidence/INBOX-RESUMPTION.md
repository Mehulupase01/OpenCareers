# Inbox and Scoped Resumption, 2026-10-09

## Delivered

- Missing parked blockers are materialized once under the owner lock. Their UUIDs
  support get, history and decisions; an inbox refresh cannot invent unusable IDs.
- Offered actions reflect actual prerequisites and are rechecked transactionally.
  A challenge needs a current bound preparation and no active handoff. Retry needs
  an active-profile assessment and no unanswered question or possible dispatch.
  Outcome review cannot offer skip, and malformed targets cannot offer reconcile.
- Failed tasks without an application retain explicit null job/application context.
  They render as background processing, remain visible and support deferral; no
  fake vacancy, whole-inbox failure or unsupported retry is introduced.
- Safe skip advances the application revision, cancels stale non-reconciliation
  tasks and handoff generations, resolves sibling blockers, and records the owner.
  An older worker lease or asynchronous inspection cannot overwrite that decision.
- Canonical answer approval propagates exact scoped matches and resumes all eligible
  affected applications in the same transaction. Remaining questions, another
  employer/meaning, terminal states, missing assessments, possible dispatch and
  restore quarantine prohibit resumption. Repeated approval creates no duplicate
  preparation while the application is already preparing. Candidate API approval
  and inbox resolution use the same implementation.
- Fresh preparation retires stale forms and handoffs and increments the application
  revision before enqueueing a packet refresh with the real assessment identifier.
  Scoped approval and propagation remain separate from final-action authority.
- Read-only reconciliation finds the original submit task through the immutable,
  checksum-verified intent. It checks owner/application, adapter, original attempt
  fence, packet and preparation bindings. Revocation of a task fence during restore
  no longer loses its original target. Active reconciliation is deduplicated.
- Challenge handoff creation and exception completion are atomic, owner-attributed
  and expiry-bound. Tokens are returned once and never persisted in plaintext.

## Verification

`corepack pnpm check` passed: lint, typecheck, ledger, production build and 281
tests across 41 files. The 101 PostgreSQL cases were skipped locally and execute
in the dedicated CI database. Final audit-attribution refinements also passed the
24 focused exception/rebuild cases; they preserve the existing public contracts.
The browser suite adds background-task rendering and deferral on both viewports.
Its manual document-inspection test explicitly pauses preparation/submission,
then resumes them to verify automatic receipt-backed synthetic final action.
All 44 isolated desktop/mobile browser cases passed in 2.4 minutes. Public-source
scan passed (257 files before staging), diff checks passed and production audit
found no known vulnerabilities. Post-push CI is pending until its run completes.

No private data migration, live inference, OAuth consent or real employer action
was performed. All application and email-related fixtures are synthetic.

## Remaining Gates

This checkpoint does not close P10. Solved browser-state continuation, robust
challenge completion proof and exact approved form-value validation on every
adapter remain open. The candidate UI still needs complete answer-scope controls.
Resumption rebuilds from stored canonical facts; new or changed employer questions
can still park an application again instead of being answered by inference.
External email evidence is not yet acquired or reconciled; that belongs to P11.
The original P11 plan's migration numbers are historical and must not be reused.
