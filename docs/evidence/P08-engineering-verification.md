# P08 Engineering Verification

Verified 2026-09-27 at `9c29659f8f06bc2aa8a66d5cfd7569ab8d318fd6`.
P08 engineering is complete, but P08 remains in progress because the genuine
live-submission gate requires private owner inputs and a suitable vacancy.

## Verified scope

- The worker records an immutable, packet- and policy-bound intent before a
  single-use fenced dispatch permit can be issued. Revocation, stale leases,
  changed artifacts, target drift and legacy unbound preparations fail closed.
- The owned mock ATS completes an unattended final click and confirms only from
  a correlated server record. Expired permits cannot click, and definitive
  validation rejection creates no receipt.
- Response loss after server acceptance becomes an unknown outcome and is
  reconciled by read-only lookup after restart. Recovery carries the original
  adapter target and never queues a second final action.
- Recruitee Careers Site API v1 preparation and multipart commit are implemented
  behind an explicit private-production gate. The adapter binds the exact tenant
  and offer, checks supported required fields and offer drift, requests a permit
  immediately before POST, and requires a returned candidate ID plus matching
  email for confirmation.
- Mock ATS and Recruitee both run through the versioned adapter SDK. The API and
  worker contain no portal-specific commit or reconciliation branches.
- Dry-run network policy returns a deterministic local rejection for attempted
  final POSTs and blocks foreign origins. It produced zero application records
  across explicit, Enter-triggered and field-change-triggered fixtures.

## Verification

- Local: lint, typecheck, production build, public-source scan and production
  dependency audit passed.
- Local Vitest: 113 passed; 54 PostgreSQL-gated cases skipped locally.
- Local Playwright: 30/30 desktop and mobile tests passed from a fresh synthetic
  reset, including commit, expired permit, response-loss reconciliation,
  definitive rejection and implicit-submit firewall cases.
- GitHub Actions run `36307529528`: Ubuntu, Windows and PostgreSQL jobs passed,
  including the adapter conformance suite and both browser matrices.
- Primary tests: `tests/integration/documents.test.ts`,
  `tests/e2e/mock-ats.spec.ts`, `tests/unit/recruitee.test.ts`, and
  `tests/unit/adapter-sdk.test.ts`.

## External verification boundary

No live application was sent during this verification. `P08-G6` requires an
explicitly reviewed private candidate profile, an active matching standing
authorization, a genuine appropriate vacancy, and a correlated private receipt.
The read-only Freeday Recruitee vacancy inspected on 2026-09-27 required Dutch
residence and regular Rotterdam attendance; eligibility was not assumed. The
adapter remains fixture-tested and provisional, never `live-verified`.

Engineering continues under `P08-G7`; no CAPTCHA bypass, anti-bot evasion, proxy
rotation, restricted logged-in scraping or blind duplicate replay is implemented.
