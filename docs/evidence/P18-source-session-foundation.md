# P18 Owner-Source Session Foundation

2026-10-10. P18 is in progress, not complete. Migration 15 is append-only
and ran only in synthetic test stores. No private browser profile, real session,
credential, employer or running private service was accessed or changed.

## Implemented

- Owner/source/adapter/origin/revision/permission-evidence/expiry-bound AES-GCM
  session storage. Ciphertext replacement is atomic and removes old secrets.
- Cookie-only scoped state, at most 30 cookies and 60 KB. Exact HTTPS host,
  secure cookies, normalized duplicate identity refusal and no parent-domain
  sharing. Challenge/clearance state is rejected, never reused as access authority.
- One-day maximum session authority, cookie-expiry checks, stop/restore/discovery
  pause gating, stale revision refusal, owner isolation and key mismatch refusal.
- Local revocation deletes ciphertext even when processing is stopped or no vault
  key is configured. API and audit responses contain metadata, not session values.
- Authenticated Discovery import/revoke controls; demo refuses private imports.
  No HTTP endpoint exports decrypted material. Internal reads are purpose-bound
  preparation inputs, not browser permits or application submission authority.

Storing a permission-evidence hash does not establish that a platform has granted
access; it binds state to the reviewed evidence supplied by the owner. No network
consumer is enabled by this storage operation. This is not LinkedIn/Indeed ingestion
and does not add another operationally supported job board.

## Evidence

`tests/integration/source-sessions.test.ts` exercises ciphertext, replacement,
scope, expiry, owner isolation, pause, revocation and challenge-state refusal on
SQLite and in the PostgreSQL CI lane. Focused local run: 28 passed, 12 PostgreSQL
skipped across this file, API trust-boundary tests and vault tests. Both desktop
and mobile Discovery browser tests passed; the mobile Sources screenshot was
inspected. The frozen full local check passed 388 tests in 47 files, with 149
PostgreSQL cases skipped locally; lint/typecheck/ledger/build passed. Public scan
passed 285 files. Commit `904a77238f46deea753d9cdb16fce2c5a254c58f` passed
Windows, Ubuntu and PostgreSQL [CI 38086701394](https://github.com/Mehulupase01/OpenCareers/actions/runs/38086701394).
P18 remains in progress; this does not activate any owner-account source.

## Remaining

P18's source catalog, reviewed ingestion adapters, localStorage-dependent sessions,
host-bound capture/export, persisted polling and cooldowns, universal hosted forms,
six public API families and five account-gated families are not completed here.
No family becomes live-verified without a genuine dated private receipt.

The 2026-10-10 access review found that [LinkedIn prohibits unauthorized automation
and scraping](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?intendedLocale=en&lang=en-us),
and [Indeed requires express permission for automated access except its stated
crawling allowance](https://www.indeed.com/legal?hl=en_US). A logged-in account or
an evidence hash alone does not waive those restrictions. Keep unsupported routes
disabled; implement permitted feeds/imports and direct-employer routes without
CAPTCHA bypass, evasion, proxy rotation or mass Easy Apply.
