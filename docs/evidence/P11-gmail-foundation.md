# P11 Gmail Foundation

2026-10-10. P11 is **in progress**, not closed or live-certified. Migration 13
is append-only. No private database, key, OAuth credentials, running service or
real employer was changed. No live Gmail request or application was sent.

## Implemented

- Owner-authenticated Mailbox workspace and API; real Gmail access disabled in demo.
- External-browser desktop OAuth consent with random state, loopback callback,
  PKCE S256, single-use callback, exact read-only scope and offline refresh.
- Owner/client/mailbox-bound encrypted OAuth clients and tokens in the existing
  vault. Local disconnect fences callbacks before remote revocation; corrupt
  ciphertext cannot prevent local disconnect. Superseded secrets are deleted.
- Expired uncertain refresh requires fresh consent; no automatic refresh replay.
  Testing authorization has a conservative seven-day bound that refresh cannot extend.
- Narrow recipient/sender/time queries for up to 50 existing contexts over at most
  14 days, provider field allowlists, fixed endpoints, redirects refused, body
  limits and timeouts. No mailbox-wide crawl, attachments, outbound mail or LLM.
- Pagination, deduplication, incremental ingestion and stop/disconnect checks
  before each request. Limits: 50 pages, 100 messages, 90 seconds per sync.
  Partial scans explicitly report partial acquisition; they are not exhaustive.
- Conservative English classifications and exact recipient, reviewed sender,
  Gmail-provided DKIM authentication result, bounded time and unique reference
  correlation. Parent/vendor sender domains require explicit owner approval.
  Original discovery metadata supplies provider requisitions/posting IDs; IDs
  are not invented by stripping internal namespaces. Role text alone never
  confirms receipt. Unrelated messages create no records or actions.
- Only minimal message metadata, hashes and typed evidence are persisted, not
  subject/body/address plaintext. Duplicate provider IDs within a mailbox create
  one outcome event. Events do not trigger replies or accept interview slots.
- Strong email receipts atomically queue only read-only reconciliation against
  the original immutable submission intent. SubmissionRepository validates stored
  message/event/packet/attempt evidence before confirming an unknown attempt.
  Caller-fabricated receipts and final-action email evidence are rejected.
- Private worker polling every five minutes, independent of discovery cadence.
  A disconnected mailbox requires no network and leaves application workflows usable.

## Evidence

Local verification: `corepack pnpm check` passed 44 files, 330 tests with 124
PostgreSQL cases skipped locally. All 46 desktop/mobile browser cases passed;
screenshots were inspected. Public scan passed 274 files; production dependency
audit reported no known vulnerabilities. Existing helper-any lint and bundle-size
warnings remain. PostgreSQL is verified separately in CI, not claimed locally.

- `tests/unit/email.test.ts`: spoofing, negation, competing roles, reference
  boundaries, account/application distinction, fields/scopes, repeated page tokens,
  partial scans, duplicate acquisition, preserving observations on later failure.
- `tests/integration/email.test.ts`: encrypted storage, owner isolation, stale
  callback fencing, local disconnect despite corrupt ciphertext, expiry recovery,
  unrelated mail, synthetic loopback OAuth/PKCE and single consumption. SQLite
  locally; the same cases are included in the PostgreSQL CI lane.
- `tests/integration/documents.test.ts`: owned synthetic uncertain submission
  becomes confirmed from stored Gmail evidence without a second attempt; duplicate
  delivery yields one event and forged evidence fails.
- `tests/integration/api.test.ts`: session protection, demo refusal, no-key refusal.
- `tests/e2e/email.spec.ts`: disconnected workspace at desktop/mobile widths,
  no page errors or horizontal overflow; synthetic screenshots only.

## Remaining Before P11 Closure

1. Durable encrypted pagination/context cursors and fair rotation for capped scans.
   The current bounded sync restarts its window; persistent high-volume first
   pages can starve older pages. Do not claim complete mailbox acquisition.
2. Bound account-verification link extraction, encrypted URL storage, reviewed
   exact GET paths, SSRF-safe pinned DNS, redirect-chain validation and account
   state evidence. `email_verification_links` is reserved, not a working feature.
   No email link is currently followed, including arbitrary recruiter links.
3. Complete provider refresh/revocation/transient failure/stop/restore matrix and
   private-configure API fixture tests. Synthetic consent is not Google consent.
4. Improve conservative language/receipt coverage and stale/multiple-attempt
   correlation, with a frozen evaluation. Classification is not a trained model.
5. Bound polling without delaying unrelated worker work; a sync can currently
   occupy the scheduler for up to 90 seconds before task acquisition.
6. Actual Google desktop credentials path and owner consent remain pending.
   Do not search private folders for credentials or activate private services.

## Protocol References

- [Google desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gmail message query parameters and scopes](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
- [Google OAuth refresh-token lifecycle and testing limitations](https://developers.google.com/identity/protocols/oauth2)
- [OAuth external user-agent policy](https://developers.google.com/identity/protocols/oauth2/policies)
