# P11 Gmail Foundation

2026-10-10. P11 implementation is awaiting final cross-platform verification,
not closed or live-certified. Migrations 13 and 14
are append-only. No private database, key, OAuth credentials, running service or
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
- Narrow recipient/sender/time queries for up to 50 existing contexts per batch over at most
  14 days, provider field allowlists, fixed endpoints, redirects refused, body
  limits and timeouts. No mailbox-wide crawl, attachments, outbound mail or LLM.
- Pagination, deduplication, incremental ingestion and stop/disconnect checks
  before each request. Limits: 50 pages, 100 messages, 90 seconds per sync.
  Partial scans explicitly report partial acquisition; they are not exhaustive.
- Encrypted, purpose-bound pagination checkpoints save page IDs before message
  acquisition and advance only after ingestion. Restart resumes incomplete pages;
  fair round-robin page selection and persisted context watermarks prevent capped
  batches from permanently omitting later contexts. Correlation includes the full
  relevant set, capped at 1,000 contexts with explicit review rather than truncation.
  Checkpoints are capped at 60 KB. Invalid scans pause without losing OAuth; an
  authenticated owner reset clears progress and fences old readers.
- Verification links are extracted only from uniquely correlated account mail.
  The pending signup, identity, original message hash and current policy are bound
  to an encrypted URL. Exact HTTPS origins, paths, token query keys and complete
  success text require owner approval; no route is approved by default. Only GET
  is allowed, with no cookies, referrer, credentials or email body in the request.
  Public-only DNS addresses are pinned to the connection; literal private IPs are
  rejected separately. Each redirect is reauthorized, with three redirects maximum,
  64 KB response and 30-second dispatch limits. HTTP 200 or a phrase buried in other
  text is insufficient. Successful accounts have hashed response/rule evidence.
  Intent precedes the request. Lost responses and stopped/revoked requests become
  unknown and cannot replay, including another token for the same account. A crash
  leaves in-flight evidence visible and non-replayable, not implicitly successful.
- Conservative English classifications and exact recipient, reviewed sender,
  Gmail-provided DKIM authentication result, bounded time and unique reference
  correlation. Parent/vendor sender domains require explicit owner approval.
  Original discovery metadata supplies provider requisitions/posting IDs; IDs
  are not invented by stripping internal namespaces. Role text alone never
  confirms receipt. Unrelated messages create no records or actions.
- Only minimal message metadata, hashes and typed evidence are persisted, not
  subject/body/address plaintext. Duplicate provider IDs within a mailbox create
  one outcome event. Events do not trigger replies or accept interview slots.
- A repeated observation also repairs the delivery-versus-queue-completion race:
  if an older read-only task finished without seeing the receipt, the next sync
  requeues reconciliation only for that same latest unknown attempt. No extra
  outcome event or submit task is created, and settled/older attempts are not requeued.
- Strong email receipts atomically queue only read-only reconciliation against
  the original immutable submission intent. SubmissionRepository validates stored
  message/event/packet/attempt evidence before confirming an unknown attempt.
  Caller-fabricated receipts and final-action email evidence are rejected.
- Private worker polling every five minutes runs as one bounded background promise,
  independent of discovery cadence and task claiming. Shutdown aborts acquisition.
  Reviewed verification follows only when external account actions are enabled.
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

## Current Verification And Boundaries

- `tests/unit/email-verification.test.ts`: adversarial URL and literal-IP refusal,
  ambiguous link refusal, exact success text and issued-grant revocation after
  scope/profile validation failure.
- `tests/integration/email-verification.test.ts`: correlated acquisition through
  encrypted capture and verified account state, duplicate delivery, 52-context
  rotation, pre-request intent, reviewed redirects, unexpected origin rejection,
  lost-response replay prevention, route removal and policy revocation mid-request.
  Owned synthetic transports only; no employer endpoint is contacted.
- `tests/integration/email.test.ts`: interrupted-page resume, ciphertext lifecycle,
  explicit scan review/reset, stop/restore fencing and local disconnect.
- `tests/integration/api.test.ts`: reviewed-route access controls, external-action
  refusal, bounded synthetic desktop credentials import and no plaintext exposure.
- All 46 desktop/mobile browser workflows passed. The Mailbox workspace includes
  reviewed-route controls, redacted link status and explicit paused-scan reset.
  The private verification dispatcher is integration-tested, not live-certified.
- Classifier coverage remains conservative English; unsupported/ambiguous mail
  does not manufacture outcomes. This is not a trained multilingual classifier.
  Rich success pages without the exact reviewed full text remain unknown; adding
  vendor-specific structured success adapters requires separate evidence.
- Cross-platform CI and the final full local suite must be recorded before closure.
  Actual Google desktop credentials path and owner consent remain pending.
  Do not search private folders for credentials or activate private services.
  P08's genuine live receipt and P15's crash/retention/soak certification remain open.

## Protocol References

- [Google desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gmail message query parameters and scopes](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
- [Google OAuth refresh-token lifecycle and testing limitations](https://developers.google.com/identity/protocols/oauth2)
- [OAuth external user-agent policy](https://developers.google.com/identity/protocols/oauth2/policies)
