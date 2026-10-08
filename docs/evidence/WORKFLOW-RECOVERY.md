# Workflow Recovery, 2026-10-09

## Delivered

- One transactional answer-approval implementation now serves the candidate API
  and exception decisions. Revisions are append-only, facts must be currently
  usable, and exception approvals default to this employer/country for 30 days.
  Evidence expiry still shortens actual usability. Owner APIs retain explicit scope.
- Suggestions use the same exact meaning, employer, country, date and current fact
  revision checks. Unknown vacancy country no longer satisfies country-restricted
  answers. Packet reuse checks exact meaning; general permit wording does not
  supply an answer to a new legal or sponsorship question.
- Retries carry a real active-profile assessment and a fresh dedupe key. Without
  an assessment, no malformed task is queued. Potentially dispatched attempts
  prohibit preparation retries. Rebuild queues inspection of the saved packet,
  retires stale preparations and revokes the handoff generation/lease.
- Reconcile queues the target from the original fenced submit task. Requests are
  deduplicated while active and the exception stays open. A later receipt can
  settle NEEDS_REVIEW without repeating submission; absent evidence remains review.
- The worker consumes durable inspection tasks, checks packet/job/profile/policy
  binding, obtains verified local CV bytes, prepares without guessed overrides,
  persists readiness and queues final action under auto-submit policy. It records
  unknown questions and refreshes packets from stored question meanings. Worker
  task leases renew during long-running operations.
- Packet lookup is by owner-scoped identifier, not the latest 100-row dashboard
  window. Retained packets also queue inspection after a preparation-task retry.
- Inspection discards terminal or owner-ready work; persistence checks the
  original application revision so an asynchronous result cannot overwrite a
  newer owner preparation. Labels no longer contain select-option text.
- Each browser run and viewport uses fresh guarded synthetic storage and dedicated
  ports. Private services and the ordinary demo workspace are untouched. Synthetic
  document submission tests explicitly approve their answers in canonical memory.
- Handoff writes fail closed except reviewed challenge endpoints. Only reviewed
  widget origins can load cross-origin resources; off-page main navigation and
  private/credential-bearing URLs are rejected. Browser access respects the
  shorter lease deadline. Early handoff completion no longer blocks a new form
  until the original future expiry.

## Verification

`corepack pnpm check`: lint, typecheck, ledger and production build passed;
38 test files, 253 passed and 89 PostgreSQL cases skipped locally. The CI lane
executes those cases against its dedicated PostgreSQL service.
`corepack pnpm public:scan` and `git diff --check` passed before staging; the
staged inventory is checked again before commit. The final isolated browser run
passed all 42 desktop/mobile cases in 2.2 minutes. Post-push CI is pending.
All fixtures are synthetic; no employer application or private migration was run.

## Remaining Gates

This is a repair checkpoint, not a new production-phase completion. P10 is reopened
because earlier closure evidence did not prove durable session continuation,
all-adapter exact answer validation or complete affected-form resumption.

Automatic target resolution currently covers the owned mock and canonical
Recruitee tenant URLs. Greenhouse remains fixture-tested with explicit reviewed
fingerprints; automatic new-form fingerprint enrollment is not silently enabled.
No adapter is live-verified. Real challenge vendor writes and solved-session
storage continuation still require adapter-specific review and implementation.
The current broker's disappearance-of-selector check is not adequate live proof.

The answer workflow must still resume all equivalent affected applications and
preserve reviewed scopes in the UI. External receipt/email reconciliation belongs
to P11. Restore blocking, artifact encryption, broad ATS coverage and release
activation remain on the approved completion plan.
Parked inbox entries without stored exceptions must become durable actionable
records, and action offerings must reflect their actual available recovery path.
