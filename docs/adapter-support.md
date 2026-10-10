# Adapter Support

The owner workspace exposes a live coverage report under Discovery > Coverage.
It counts all open persisted jobs per portal family and tenant, reports each
tenant's eligible and open counts, joins the latest assessment for the active
profile, and ranks families by eligible jobs, then
open jobs and discovery maturity. Unassessed jobs are shown separately. The
report does not turn a fixture or public read into live submission evidence.
The same view publishes a dated, variant-level support matrix. Its entries are
curated engineering evidence, separate from the owner's live vacancy counts;
an observed challenge on one employer form does not classify every posting in
that portal family.

| Family | Discovery | Inspect/fill | Commit/receipt | Reconciliation | Live evidence |
| --- | --- | --- | --- | --- | --- |
| Owned mock ATS | Fixture-tested P07 | Dry-run-tested P07 | Auto-submit tested P08 | Correlated receipt and recovery tested P08 | Synthetic only |
| Recruitee Careers Site API v1 | Collection live-read and fixture-tested P09 | Payload preparation tested P08 | Multipart commit and candidate-ID receipt fixture-tested P08 | Email reconciliation pending P11 | Freeday collection read-only, 2026-09-27; live POST pending |
| Lever hosted Protolabs variant | Public form inspected read-only | Unsupported: substantive answers and challenge | None | None | Public read-only 2026-09-27 |
| Greenhouse public Job Board GET / hosted external form | Live-read P04 | Fingerprint-pinned hosted form fixture-tested P09; unknown controls and challenges blocked | One guarded POST and correlated receipt fixture-tested P09 | Unknown outcomes stop without replay; read-only recovery pending P11 | DEPT/Adyen public reads only; no live POST or private receipt |
| Lever public postings GET | Fixture-tested P04 | Planned | Planned | Planned | No live read |
| Ashby public posting API v1 | Fixture-tested and public read P18 | Planned | Planned | Planned | Ashby board, 68 listed postings, 2026-10-10; no employer write |
| Personio enabled XML feed | Fixture-tested and public read P18 | Planned | Planned | Planned | Personio board, 1 posting, 2026-10-10; office text only, no employer write |
| SmartRecruiters public Posting API | Fixture-tested and public read P18 | Planned | Planned | Planned | Sana Commerce, 6 postings plus descriptions, 2026-10-10; bounded complete scans only, no employer write |

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
Discovery reads one bounded `/api/offers/` snapshot and binds stable numeric offer
identity to the submission-facing slug. See
[P09 discovery research](sources/P09-recruitee-discovery.md) for the current public
read and the documented February 2027 token boundary.

The Greenhouse hosted adapter is limited to the exact
`https://job-boards.greenhouse.io/{board}/jobs/{postingId}` origin and an
explicitly pinned inspected form fingerprint. Preparation blocks every write;
commit reinspects and reads back all fields, then permits one exact POST only
after durable intent and dispatch authorization. The synthetic receipt binds
board, posting, job, email hash and receipt URL. Changed or unknown controls,
challenges, pre-submit upload traffic, extra writes, validation rejection and
ambiguous responses fail closed. This is fixture-tested engineering support,
not live-verified employer support.
