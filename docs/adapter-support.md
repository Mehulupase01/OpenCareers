# Adapter Support

| Family | Discovery | Inspect/fill | Commit/receipt | Reconciliation | Live evidence |
| --- | --- | --- | --- | --- | --- |
| Owned mock ATS | Fixture-tested P07 | Dry-run-tested P07 | Auto-submit tested P08 | Correlated receipt and recovery tested P08 | Synthetic only |
| Recruitee Careers Site API v1 | Live-read and fixture-tested P08 | Payload preparation tested P08 | Multipart commit and candidate-ID receipt fixture-tested P08 | Email reconciliation pending P11 | Freeday offer read-only, 2026-09-27; live POST pending |
| Lever hosted Protolabs variant | Public form inspected read-only | Unsupported: substantive answers and challenge | None | None | Public read-only 2026-09-27 |
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

The first Recruitee variant is limited to exact `https://{tenant}.recruitee.com`
Careers Site API origins, published offers, one location, PDF CV, identity/phone,
text cover letter, supported single-value screening questions and server-returned
candidate IDs. Preparation performs GET only. Unknown question kinds, file or
multi-choice questions, required multi-location selection, unanswered questions,
offer drift, redirects and uncorrelated receipts fail closed. A returned 422 is a
definitive rejection; any transport loss or non-documented status remains unknown.
