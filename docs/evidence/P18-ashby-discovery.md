# P18 Ashby Public Discovery

2026-10-10. Discovery only, not an Ashby application adapter or P18 closure.
The [published posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)
is fetched by the existing credential-free, public-DNS-pinned GET transport.
Only the public board path is allowed; employer-facing API paths are refused.

The typed complete-snapshot parser accepts API version 1 and only listed postings.
Hosted URLs must match the exact configured Ashby board. Duplicate IDs and schema
drift fail the scan without claiming completeness. Posting identity, timestamps,
source locators and country evidence enter the existing discovery repository,
deduplication, quality-warning and closure controls. Unknown explicit countries,
including European Union, stay unknown rather than becoming Netherlands claims.
Discovery configuration and hosted URL recognition are available in the owner UI.
The support matrix shows public-read discovery and planned application operations.

## Dated Read

- Endpoint: `https://api.ashbyhq.com/posting-api/job-board/Ashby`
- Observed: `2026-10-10T21:15:35.461Z`; HTTP 200, 68 normalized postings.
- Response SHA-256: `b43fe6c8efbec32261eafa82c72f0d4f37f8b09500b441442353d8c478155c60`.
- Raw response and normalized listings retained in ignored isolated probe database
  `.cache/ashby-public-read-P7N3UX/evidence.sqlite`. No candidate was imported,
  private database opened, inference invoked or application submitted.

Unit and SQLite/PostgreSQL integration fixtures cover normalization, hidden
postings, host/tenant substitution, duplicate IDs, schema drift, region scope,
deduplication and honest support reporting. Focused initial suite: 27 passed,
11 PostgreSQL skipped across Ashby and existing discovery/coverage tests.
Full local check: 397 passed, 150 PostgreSQL skipped, 49 test files; lint,
typecheck, ledger and build passed. All 48 desktop/mobile browser cases passed;
the mobile coverage screenshot was inspected. Final typecheck also passed after
the fixture-label and 20-minute default adjustments. The other five public families and all gated portal adapters
remain separate P18 requirements; this does not satisfy 20-board coverage.
