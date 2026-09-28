# P10 Security Checkpoints

P10 remains in progress. This file records verified increments without claiming
that exception resolution or safe form rebuilding are complete.

## Account Vault And Signup

- Migration v9 stores only AES-256-GCM credential envelopes. Authenticated data
  binds owner, secret ID, purpose, and key version.
- Account reads return redacted metadata. Decryption requires the exact owner,
  employer origin, adapter, and credential purpose.
- Signup creates one durable intent and obtains one dispatch permit immediately
  before the single fixture POST. A lost response becomes `unknown`; replay is
  rejected as a possible duplicate.
- Local verification passed 167 tests with 63 PostgreSQL-only skips, plus lint,
  typecheck, build, public-source scan, and production dependency audit.
- GitHub Actions run `36457888701` passed Windows, Ubuntu, and PostgreSQL at
  commit `8b2a40b`.

## Challenge Handoff Lease Foundation

- Only a current `CHALLENGE_REQUIRED` application and its exact challenge
  preparation can create a handoff.
- A 256-bit opaque token is returned once; only its SHA-256 hash is persisted.
  Snapshot responses never include the token.
- Claims require the exact owner and token, then acquire one bounded exclusive
  browser lease. Completion requires the exact lease owner and generation.
- Completion retires the challenged preparation and moves the session to
  `rebuilding`; it does not authorize or perform an application submission.
- Active, unexpired handoffs block the submission transaction under the same
  owner lock. Expired handoffs are retired before a replacement is created.
- SQLite and PostgreSQL integration coverage exercises owner isolation, invalid
  tokens, competing claims, stale lease completion, target drift, preparation
  expiry, replacement after expiry, and the final-action interlock.
- GitHub Actions run `36459028331` passed Windows, Ubuntu, and PostgreSQL at
  commit `678c85c`.

## Visible Challenge Broker

- Authenticated loopback API routes create, claim, list, and complete handoffs.
  Creation returns the opaque token once; list responses contain no token.
- The owned synthetic ATS opens in a dedicated visible Chromium context. Its
  network policy permits the scoped challenge while blocking the application
  endpoint. Completion independently verifies that the challenge disappeared
  and that no final request was attempted.
- Browser ownership is held by one random internal lease identity and one
  generation. The context closes on completion, server shutdown, launch error,
  or absolute handoff expiry.
- The owner UI exposes bounded open/complete controls only for challenge
  preparations. Completion moves the record to `rebuilding`; it does not make
  the human browser eligible to submit.
- Authenticated API integration covers the full create/open/complete sequence.
  Playwright covers successful challenge handling, stale-generation rejection,
  and forced final-action blocking on desktop and mobile projects. Repository
  integration proves unrelated queue work can still be leased.
- External adapters are not yet enabled in this broker. They require explicit
  per-adapter resource and final-action policies; arbitrary browsing is rejected.
- Full local verification passed 172 tests with 67 PostgreSQL-only skips, all 36
  desktop/mobile Playwright workflows, lint, typecheck, production build,
  public-source credential scan, and production dependency audit.

No CAPTCHA solving, MFA interception, anti-bot evasion, proxy rotation,
restricted scraping, employer account creation, or employer application write
was performed by these checks. The exception inbox, external-adapter handoff
policies, and fresh post-handoff rebuild remain pending.
