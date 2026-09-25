# P08 Actual Submission Vertical Slice

Plan prepared 2026-09-26 from masterplan phase P08, the existing persistence
protocol and the owner's standing auto-submit amendment. P07 READY is necessary
but never sufficient authority to make a final click.

## Decision Boundaries

- Keep one authoritative state store. An application has one active intent and
  at most one in-flight attempt. No browser action may precede a committed
  intent and attempt record.
- Recheck the active profile, unrevoked standing policy, scope, job freshness,
  duplicate identity, answer validity, immutable packet, artifact hashes and
  matching browser preparation in the same transaction that grants commit
  authority. A stale task fence or policy revision cannot gain a capability.
- Bind intent to owner, application, job/requisition, packet and artifact hashes,
  authorization revision, adapter version, form fingerprint and exact answers.
  Keep the capability short lived and single use. Revalidate authorization
  immediately before dispatch; a revoked or stopped owner prevents the click.
- Permit final action only through the commit engine and an explicit adapter
  method. Dry-run contexts remain unable to reach the application endpoint.
  Do not add CAPTCHA bypass, anti-bot evasion, proxy rotation or unauthorized
  logged-in scraping. Challenges pause only their application.
- Separate observations from classifications. A banner, redirect, status 200,
  account creation or upload acceptance cannot confirm submission. A strong
  receipt has the job/application identity and unique server-side record; a
  validation rejection is definitive; network loss and ambiguous evidence are
  UNKNOWN and require read-only reconciliation.
- Never replay the final click after an in-flight crash or unknown outcome.
  Reconciliation searches by durable correlation identifiers and records its
  evidence. Absence of a receipt is not proof of non-submission.
- Implement and test the entire protocol against the owned mock ATS first.
  Select a permitted real portal from current relevant vacancies only after
  reviewing its published access path and an owner-controlled account. Label
  it live-verified only after a genuine appropriate submission and private
  correlated receipt. Missing live prerequisites remain an explicit external
  verification status, not a simulated success.

## Implementation Order

1. Add typed commit intent, capability, attempt and receipt evidence contracts;
   migration and repository invariants for uniqueness, revision checks and
   idempotent reconciliation.
2. Implement transactional precommit gate and fencing with revocation and
   concurrency tests on SQLite and PostgreSQL.
3. Extend the mock ATS with controlled response-loss, validation-failure,
   duplicate-click and read-only record lookup fixtures. Add an explicit
   commit-capable browser context separate from dry run.
4. Orchestrate automatic mock submission and strong receipt correlation.
   Persist IN_FLIGHT before dispatch, then CONFIRMED, DEFINITIVE_FAILURE or
   UNKNOWN with audit and receipt evidence.
5. Implement crash recovery and read-only reconciliation without blind replay.
   Exercise every fault boundary, stale worker, immediate revocation and
   simultaneous submission attempts.
6. Expose accurate status and evidence in API/UI, with no fake submitted count.
   Verify desktop/mobile, cross-platform CI, PostgreSQL and private-data scan.
7. Research and implement the first compliant real adapter from an appropriate
   current vacancy. Keep real credentials and receipts outside Git. Report
   code completion separately from the required live verification gate.

## Acceptance

P08-G1 through G5 require the mock auto-submit, correlated receipt, crash-safe
reconciliation, revocation and stale-worker tests. P08-G6 requires a real,
appropriate receipt-verified application and cannot be satisfied with the mock
server. P08-G7 requires the ledger and handoff to show any missing external
prerequisite plainly while unrelated engineering continues.
