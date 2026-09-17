# Adapter Support

| Family | Discovery | Inspect/fill | Commit/receipt | Reconciliation | Live evidence |
| --- | --- | --- | --- | --- | --- |
| Owned mock ATS | Planned P07 | Planned P07 | Planned P08 | Planned P08 | Synthetic only |
| Recruitee | Planned | Candidate first adapter | Planned | Planned | None |
| Greenhouse public Job Board GET | Live-read P04 | Planned | Planned | Planned | Adyen board, 2026-09-17 |
| Lever public postings GET | Fixture-tested P04 | Planned | Planned | Planned | No live read |
| Ashby | Planned P04 | Planned | Planned | Planned | None |

Select the first real adapter from relevant permitted vacancies at P08. Support
levels: planned, fixture-tested, dry-run-tested, live-verified. Each variant records
adapter version, date, evidence, field coverage and limitations independently.
Public listing access does not authorize employer-facing application APIs.

P04 discovery variants are fixed-origin, unauthenticated readers. Greenhouse uses a
complete board snapshot with conditional ETag revalidation. Lever global/EU traverses
documented `skip`/`limit` pages. Support excludes authenticated listings, redirects,
arbitrary career sites, browser scraping and all application writes. See
[P04 evidence](evidence/P04-verification.md) for exact scope and date.
