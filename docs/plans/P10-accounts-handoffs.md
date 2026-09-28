# P10 Accounts, Secure Handoffs, and Exceptions

Planned 2026-09-28 after P09 completed at `a3233bf`. P08 live receipt
verification remains independent and does not block synthetic P10 engineering.

## Security Boundaries

- Treat credentials, MFA material, recovery codes, cookies and browser storage
  as secrets. They never enter model prompts, task payloads, audit payloads,
  ordinary logs, exceptions, receipts or Git.
- Encrypt secrets with AES-256-GCM under a dedicated versioned vault key loaded
  from the private environment. Persist only ciphertext, nonce, authentication
  tag, key version and non-secret metadata. Never derive the vault key from a
  database value or expose decrypted values through API responses.
- Bind account records to owner, candidate, exact employer origin and adapter.
  Unknown origins, redirects, shared credentials and arbitrary browser actions
  fail closed.
- Model signup as a one-action commit: durable intent and account attempt first,
  one short-lived dispatch permit immediately before the final request, then a
  correlated account receipt. A lost response becomes `unknown`; it is never
  retried automatically.
- CAPTCHA and MFA are human handoffs, not solvable tasks. A handoff permits only
  the bounded challenge or login interaction. Application-submit controls and
  employer application POSTs remain blocked. After completion, automation
  closes the interactive context, reinspects in a fresh context and retains sole
  authority for the final application action.
- Store only a hash of each opaque handoff token. Require the authenticated owner
  session as well as the one-time token. Bind the record to one application,
  preparation, adapter target, browser-session generation and expiry.
- Fence browser ownership. `automation`, `human_handoff`, `rebuilding` and
  `closed` are mutually exclusive leases; stale generations cannot act. Expiry,
  cancellation and restart invalidate the browser session.
- Reuse approved answers only through the existing exact semantic-key, meaning,
  employer, country, date and evidence-revision checks. No embedding or fuzzy
  similarity may propagate legal, work-authorization, sponsorship, salary,
  demographic or consent answers.

## Implementation Order

1. Add vault configuration, authenticated encryption primitives, redaction
   guards and migration tables for vault secrets, employer accounts, signup
   intents/attempts and handoff sessions. Prove tamper detection and owner
   isolation on SQLite and PostgreSQL.
2. Add an account registry repository and protected API. Return only status,
   employer origin, adapter, timestamps and masked identity metadata. Add an
   owned signup fixture with success, validation rejection, response loss,
   duplicate and verification-required outcomes.
3. Implement signup preparation/commit with standing-policy account permission,
   exact-origin binding, generated unique passwords, one dispatch permit and
   correlated account evidence. Unknown outcomes enqueue read-only
   reconciliation and cannot create a second account.
4. Add durable handoff leases and a loopback-only visible-browser broker. Block
   final application actions during handoff, require owner authentication plus
   one-time token, and expire or revoke every stale generation.
5. Add the exception inbox and bounded resume controls to Applications. Show the
   exact blocker and supported next action without secrets. Resolve approved
   answers through existing exact semantics and requeue only affected work.
6. Rebuild expired forms from packet and active policy. Reconcile any ambiguous
   prior commit before reconstruction. Test races between user interaction,
   worker leases, revocation, expiry and final action.
7. Publish support/evidence and run local, Windows, Linux, PostgreSQL, desktop,
   mobile, secret-scan and dependency-audit gates.

Checkpoint 1 implemented: vault configuration and authenticated encryption,
migration v9 storage, and the redacted account repository. Signup dispatch,
handoff brokering and exception UI remain in progress.

## Acceptance Mapping

- P10-G1/G2: encrypted vault plus one-action signup and unknown-outcome tests.
- P10-G3/G4/G5: scoped visible handoff, owner/token/expiry checks and exclusive
  browser-generation fencing.
- P10-G6: exact semantic propagation tests for near-identical sponsorship and
  legal questions.
- P10-G7: expired-form rebuild tests with reconciliation-first enforcement.

No CAPTCHA bypass, anti-bot evasion, proxy rotation or restricted logged-in
scraping is part of P10.
