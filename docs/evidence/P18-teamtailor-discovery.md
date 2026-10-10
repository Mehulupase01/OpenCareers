# P18 Teamtailor RSS Discovery

2026-10-10. Discovery only, not an application adapter or phase closure.
[Teamtailor's public RSS documentation](https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide)
documents metadata and offset/per_page pagination. The default first 100 jobs are
not a complete scan. This variant uses only exact `{tenant}.teamtailor.com` feeds,
no custom domains, employer API token, owner session or application write.

The public-DNS-pinned GET reader accepts only `/jobs.rss?offset=N&per_page=100`.
Typed XML parsing rejects DTD/entity declarations, excessive nesting, malformed
fields and unexpected channel collections. Channel and job links must match the
configured tenant. Descriptions, publication dates, primary location and known
remote status enter the existing leased evidence/identity pipeline. Every page
is retained with a date/hash. Duplicate posting IDs across pages, repeated global
IDs within a page and incomplete bounded scans fail without ingesting a partial
snapshot. Pagination continues until a page contains fewer than 100 items.
Counts/order cannot provide an atomic upstream snapshot guarantee.

## Dated Read

- Endpoint: `https://career.teamtailor.com/jobs.rss?offset=0&per_page=100`.
- Observed: `2026-10-10T21:48:04.400Z`; HTTP 200, 13 normalized postings.
- SHA-256: `16e847084af265e0737e5c0e13c5c802d47630421408fedbed2240298756f430`.
- Raw response and normalized listings retained in ignored isolated
  `.cache/teamtailor-public-read-v9ajL2/evidence.sqlite`.
- Probe: `corepack pnpm exec tsx scripts/probe-public-source.ts teamtailor career global Teamtailor`.

Unit fixtures cover two-page 101-job traversal, repeated full pages, exact-tenant
checks, duplicate IDs, malformed/hostile XML, empty terminal feeds, namespace
locations and unsupported routes. SQLite/PostgreSQL lifecycle tests prove
deduplication and honest discovery-only coverage. Final checks are recorded in
the handoff: 44 focused tests passed, 11 PostgreSQL skipped across six files;
typecheck/lint/ledger/build passed and public scan passed 305 files. All twelve
desktop/mobile discovery cases passed, with mobile screenshot inspection. Full
cross-platform/browser CI follows the push. P18-G4 remains in progress because Breezy remains outstanding;
universal forms, reviewed owner ingestion, operational board coverage and gated
application families are also still required.
