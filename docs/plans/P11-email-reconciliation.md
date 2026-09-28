# P11 Email Integration and Receipt Reconciliation

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
This depends on P10 checkpoints 1 to 4, which are complete in
`docs/evidence/P10-security-checkpoints.md`; P10-G6 and P10-G7 are still
`not_started`, and owner OAuth client setup plus P08-G6 remain externally
blocked.

## Decision Boundaries

- Do not create a second outcome store. A message is evidence attached to an
  existing application. Only `SubmissionRepository.confirmReceipt` inside the
  commit-authority transaction may write `CONFIRMED`.
- Make email actually close the open adapter gap.
  `RecruiteeSubmissionAdapter.reconcile` and
  `GreenhouseSubmissionAdapter.reconcile` in
  `packages/browser/src/adapter-sdk.ts:222` and `:266` return `null`
  unconditionally, and `SubmissionRepository.reconcileReceipt`
  (`packages/persistence/src/submission-repository.ts:700`) throws
  `ADAPTER_UNSUPPORTED` for anything other than `mock_ats`. That is the work.
- Fail closed on linkage. `receiptEvidenceSchema` in
  `packages/contracts/src/submission.ts` is a discriminated union on `kind`;
  add a typed email kind rather than a loose payload, and reject any message
  that is not uniquely bound to one pending application.
- Never treat a time window as correlation. Two roles at one employer, or two
  employers behind one sender domain, stay `needs_review` unless recipient,
  requisition ID, portal application ID or exact account identity is unique.
- Treat mail as untrusted input. Message text is data, never instruction. It
  must not enter a model prompt, task payload, audit payload or exception
  message body.
- Store OAuth material in the existing AES-256-GCM vault
  (`packages/security/src/vault.ts`, migration v9 `vault_secrets`) under a
  distinct credential purpose with owner binding and key version. Never in
  config, environment dumps, logs, API responses or ordinary columns.
- Request the least sufficient scopes. A scope change, refresh failure,
  revocation, or a testing-mode versus deployed-app mismatch must move the
  connection to an explicit reconnect state and stay there. Never widen a scope
  automatically to make acquisition succeed.
- Do not follow a verification link outside the exact pending signup's
  expected origin chain. `commitSignup`'s `redirect:"error"` covers a POST, not
  an emailed GET. Add an independent validator that rejects unexpected
  domains, scheme changes, non-GET targets and any instruction to disclose
  secrets.
- Never reply to a recruiter, accept an interview slot, or send outbound mail
  from this phase. Outbound mail is an unauthorized external action.
- Make delivery idempotent. Duplicate delivery, thread re-fetch and repeated
  sync windows produce exactly one outcome event per provider message id.
- Never downgrade honesty for convenience. A correlated email is not
  automatically a strong receipt. Absent unique identity evidence, the
  application stays `UNKNOWN` and `needs_review`. Absence of mail is not
  rejection.

## Implementation Order

1. Add contracts and migration v10. New `packages/contracts/src/email.ts` for
   connection, message reference, correlation candidate and outcome-event
   types; extend `receiptEvidenceSchema` in
   `packages/contracts/src/submission.ts` with the email kind and its
   correlation fields. Append to `packages/persistence/src/migrations.ts` (v9 is
   current) creating `email_connections`, `email_messages`,
   `email_verification_links` and `email_outcome_events`, unique on
   `(owner_id, provider_message_id)`. Add
   `packages/persistence/src/email-repository.ts`. Prove with
   `tests/unit/contracts.test.ts` and
   `tests/integration/email-repository.test.ts` on SQLite and PostgreSQL.
2. Add a narrow provider interface and two implementations behind it: a
   synthetic fixture provider used by every test, and a real OAuth provider
   restricted to a fixed origin with redirect refusal, timeouts and an explicit
   field allowlist. Prove minimality in `tests/unit/mail-provider.test.ts` by
   asserting the acquisition call never requests a field outside the declared
   allowlist, and that query windows are bounded to pending contexts.
3. Implement the OAuth lifecycle: connect, refresh, revoke, reconnect and
   expiry transitions, with tokens sealed by `packages/security/src/vault.ts`
   and every transition audited. Add authenticated routes in
   `apps/api/src/email.ts` and register them in `apps/api/src/server.ts`.
   Prove in `tests/unit/mail-oauth.test.ts` and additions to
   `tests/integration/api.test.ts` that no token string ever reaches a
   response body, a log line or an audit payload.
4. Implement acquisition and correlation. `EmailRepository.matchPending`
   scores recipient, sender or employer domain, requisition id, portal
   application id and local-day window, and returns correlated, ambiguous or
   unrelated. Add `SubmissionRepository.reconcileFromEmail` so a uniquely
   correlated message can reach the existing receipt transaction. Prove with
   `tests/integration/email-correlation.test.ts`: account-created versus
   application-received messages are distinguished, two roles at one employer
   stay separate, and an unrelated synthetic message creates zero actions and
   zero rows on any application.
5. Add the verification-link validator and its bounded open path. It may only
   reach a chain anchored to one pending signup's exact employer origin, and it
   must never hold commit authority. Prove hostile fixtures in
   `tests/unit/verification-link.test.ts` and the owned flow in
   `tests/e2e/email-verification.spec.ts` against the synthetic ATS mail
   fixture.
6. Wire adapters and reconciliation. Replace the unconditional `null` in
   `packages/browser/src/adapter-sdk.ts` reconcile methods with
   email-consumable evidence, keep `reconcileWithoutReceipt` ending in
   `needs_review`, and make outcome recording idempotent. Prove with
   `tests/integration/reconcile-email.test.ts` that duplicate delivery yields
   one outcome event, and that an ambiguously correlated message never reaches
   `CONFIRMED`.
7. Add the owner surface in `apps/web/src/email.tsx`: connection state, the
   reconciliation queue with "evidence insufficient to conclude" wording, and
   zero token display. Extend the operations summary so a disconnected mailbox
   is visible and nothing else degrades. Prove discovery, matching, packets,
   mock submission and handoff still work with the mailbox disconnected in
   `tests/e2e/email.spec.ts` on desktop and mobile projects.

## Acceptance Mapping

- P11-G1 "OAuth refresh and revocation produce correct state transitions
  without exposing tokens." `tests/unit/mail-oauth.test.ts` plus
  `tests/integration/api.test.ts`, with vault sealing in
  `packages/security/src/vault.ts`.
- P11-G2 "Synthetic unrelated messages never trigger actions or appear in
  application records." `tests/integration/email-correlation.test.ts` and the
  field-allowlist assertion in `tests/unit/mail-provider.test.ts`.
- P11-G3 "Account-created and application-received messages are correctly
  distinguished." `tests/integration/email-correlation.test.ts` over both
  P10 account lifecycle and P08 receipt states.
- P11-G4 "Two roles at the same employer do not receive the same receipt
  unless identity evidence supports it." `tests/integration/email-correlation.test.ts`.
- P11-G5 "Unexpected verification-link domains are rejected."
  `tests/unit/verification-link.test.ts` and
  `tests/e2e/email-verification.spec.ts`.
- P11-G6 "Duplicate email delivery creates one outcome event."
  `tests/integration/reconcile-email.test.ts` against the unique provider
  message id.
- P11-G7 "The app remains useful with Gmail disconnected."
  `tests/e2e/email.spec.ts`, asserting discovery, matching, packet generation,
  mock submission and the P10 handoff flow are unaffected.

## External Gates

Owner OAuth client setup cannot be synthesized. It requires a Google Cloud
project, a configured OAuth consent screen, a client id and secret, an approved
redirect URI on the owner's machine, and an explicit decision about published
versus testing status, because a testing-mode refresh token expires in seven
days and 100 refreshes. Until the owner provides it, the OAuth lifecycle is
verified only against the synthetic provider, and that distinction must be
printed in the evidence file rather than smoothed over. P08-G6 also stays
`blocked_external`: no genuine private receipt exists, so T23 and T24 are
proven against synthetic mail only and no adapter may be labelled live-verified
as a result of this phase.

## Traceability Gaps Closed

- T23, "Account-created email", recorded `missing` in
  `docs/masterplan-traceability.md` because there is no mail layer, no evidence
  kind in `packages/contracts/src/submission.ts` and no correlation in
  `SubmissionRepository.confirmReceipt`. This phase adds both.
- T24, "Verification link redirect", recorded `missing` because `commitSignup`'s
  `redirect:"error"` covers a POST, not an emailed link. This phase adds the
  independent link validator.
- R06 support: the external confirmation limb of "Fill and finally submit
  supported forms" gains a second, narrow evidence path that still cannot
  create commit authority.
- R07 support: "Recover ambiguous submissions without blind replay" gains the
  read-only email correlation route. The T32 login blocker to an account
  exception remains P10 work and is not claimed here.

## Out Of Scope

This phase does not send, reply to, forward or delete any mail, does not
accept interview times, does not crawl a mailbox for general search, does not
build the outcome ledger, cohort reporting or calibration that belong to P16,
and does not add portal-native account lookups beyond consuming mail evidence
through the existing adapter `reconcile` contract. It does not create or verify
employer accounts beyond the P10 vault, and it does not attempt to close
P08-G6. No employer endpoint is contacted by any test written here.
