# P18 Workable Public Discovery

2026-10-10. Discovery only, not an application adapter or phase closure.
Reference: [Workable's documented public account endpoint](https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page).
Only published account feeds with descriptions are used. Authenticated SPI and
employer application APIs remain excluded; no session or token is sent.

The documented `www.workable.com/api/accounts/{tenant}?details=true` currently
redirects to `apply.workable.com/api/v1/widget/accounts/{tenant}?details=true`.
Only that exact same-tenant destination is accepted, once. Both responses retain
dated raw evidence, and each normalized job points to the final feed page. Other
origins, tenants, queries and redirect chains fail without ingestion. Transport
pins public DNS, preserves HTTPS and imposes the existing response/time bounds.

Typed wire fields, shortcode identity, exact hosted URL/shortlink validation,
descriptions and date-only publication evidence enter the existing complete-feed
deduplication/closure pipeline. Boardless shortlinks are accepted only inside an
already tenant-bound public response; they cannot identify a board during source
setup. Only the primary visible location is normalized; all-hidden locations
stay unknown. Geographic `state` is not mistaken for publication state, false
telecommuting is not invented on-site evidence, and missing dates stay unknown.

## Dated Read

- Tenant: `careers`, company Workable, 2 normalized postings with descriptions.
- First response: `2026-10-10T21:41:06.391Z`, HTTP 302.
- Feed response: `2026-10-10T21:41:06.574Z`, HTTP 200.
- Feed SHA-256: `621800e0eeae80f46e2343249d156853ee254bc85995493eb293ac3777b94631`.
- Raw redirect/feed and normalized listings retained in ignored isolated
  `.cache/workable-public-read-Wks3hy/evidence.sqlite`.
- Probe: `corepack pnpm exec tsx scripts/probe-public-source.ts workable careers global Workable`.
- The old `workable` sample tenant returned 404, not a successful job sample.

Focused connector/identity/coverage regression check: 77 passed, 11 PostgreSQL
skipped across eight files. Workable fixtures exercise direct/redirected feeds,
lookalike/tenant/ID substitution, unexpected redirects, missing descriptions,
duplicate IDs, hidden locations, unknown dates and blocked employer routes.
SQLite/PostgreSQL lifecycle checks prove deduplication and honest support levels.
Full local check: 452 passed, 155 PostgreSQL skipped, 55 files; lint, typecheck,
ledger and production build passed. All ten desktop/mobile discovery cases passed
with the four new sources and existing history/identity workflow together; mobile
screenshot inspected. Public scan: 301 files. Full cross-platform/browser CI
follows the push. P18 stays open;
Teamtailor, Breezy, universal forms, reviewed owner ingestion, operational board
coverage and gated application families remain separate requirements.
