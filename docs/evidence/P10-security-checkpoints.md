# P10 Security Checkpoints

P10 remains in progress. This file records verified increments without claiming
that visible challenge handoffs, exception resolution, or safe form rebuilding
are complete.

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

No CAPTCHA solving, MFA interception, anti-bot evasion, proxy rotation,
restricted scraping, employer account creation, or employer application write
was performed by these checks. The loopback API, visible browser broker,
exception inbox, and fresh post-handoff rebuild remain pending.
