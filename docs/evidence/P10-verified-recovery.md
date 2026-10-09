# P10 Recovery Closeout

2026-10-09. This supersedes the overstated historical P10 closure. GitHub run
37864831023 passed Windows, Ubuntu and PostgreSQL at
`50ad0608b9d7c89e4c4a48b0b4d55d5561e01a1d`; live portal support is not claimed.

## Delivered

- Every application prepare/commit entrypoint installs the canonical answer guard.
  Raw answer maps cannot authorize sensitive fields. Exact wording, employer,
  country, approval dates and current fact revisions are checked before filling.
  Identity labels cannot masquerade as unrelated questions; ambiguous multi-part
  name splits require exact owner approvals. Packet identity/artifacts are immutable.
- Dispatch rechecks all prepared values under the owner transaction before setting
  the single-use dispatch marker. Known pre-dispatch policy/profile/answer/session
  refusals are blocked before dispatch, not mislabeled as employer uncertainty.
- Handoff completion requires the original visible application form, pinned URL,
  current generation/deadline and zero attempted final actions. A disappearing
  challenge alone is insufficient proof.
- Migration 12 stores authenticated encrypted continuations in the existing vault.
  Owner, handoff, generation, application, adapter, target, packet, profile,
  authorization revision and expiry are verified against the encrypted payload.
  Only explicitly reviewed, same-origin employer cookies can be retained. CAPTCHA,
  clearance and third-party widget tokens are excluded, even if mistakenly listed.
- Completion, ciphertext storage, stale-form retirement and fresh-inspection queueing
  are atomic. Inspection revalidates the continuation before each step and before
  saving readiness. A changed handoff generation cannot create a READY preparation.
  Successful reinspection settles the handoff before queuing a separately permitted
  final action; expiry is checked again at dispatch.
- Login blockers are classified as account/session exceptions. Unsupported login
  variants remain explicit, not guessed credentials or blind retries.

## Evidence

`tests/integration/documents.test.ts` covers the exact-wording/scope/date/value/fact
matrix, identity-label misuse, approval changes between intent and dispatch, and a
real owned-browser sequence: challenge, owner interaction, encrypted persistence,
closed browser, fresh inspection, fresh commit browser and one correlated receipt.
It also rejects unreviewed clearance cookies, target tampering, wrong packet,
revoked authorization, a generation race during inspection and expired state.
These persistence cases run on SQLite and PostgreSQL in CI.

`tests/integration/api.test.ts` proves authenticated completion, redacted responses
and automatic queueing. The existing handoff/rebuild tests prove owner/lease expiry,
queue independence, final-action blocking, stale preparation refusal and
reconciliation before any rebuild. The external fixture additionally rejects a
vanished application form. The desktop/mobile suite covers the owner UI and actual
mock final actions without contacting employers.

All 41 unit/integration files passed on Windows and Ubuntu, and all 19 integration
files passed in the dedicated PostgreSQL lane. All 44 desktop/mobile browser cases
passed on each operating system. Lint, typecheck, public-source scan, build and
production dependency audit passed. The phase ledger now records 10 of 19 phases
and 72 of 128 gates complete.

## Boundaries

This closes workflow-engine acceptance against owned fixtures, not live ATS
certification. Production Greenhouse/Recruitee cookie allowlists are deliberately
empty until their ordinary authentication cookies and exact variants are reviewed.
They never export challenge clearance. Greenhouse automatic discovery-to-inspection
routing and unsupported account-login variants remain portal-coverage work.
No live challenge, employer action, private migration, mailbox authorization or
OpenRouter inference occurred. Existing private processes/data were not restarted
or upgraded. Migration 12 requires a coordinated operator rollout before those
processes adopt it. P08 live receipts and P11-P18 release requirements remain open.
