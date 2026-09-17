# P04 Discovery, Identity And History Verification

2026-09-17. Local verification is complete. Public fixtures and committed history
records are synthetic. One public Greenhouse board was read without credentials for
the required live, read-only gate; no application form was opened or submitted.

## Acceptance Evidence

| Gate | Evidence |
| --- | --- |
| G1: Poll deduplication | SQLite/PostgreSQL repository tests replay complete and conditional Greenhouse scans. Source, listing, canonical job and application identities remain stable; scheduling and leases prevent overlapping or stale poll commits. |
| G2: Pagination boundaries | Unit fixtures exercise Greenhouse full snapshots and Lever pages below, at and above the 100-record boundary, including the terminal empty page for an exact multiple. Duplicate posting IDs and incomplete full-feed counts fail the run without replacing prior truth. |
| G3: Distinct source states | Complete scans use `open`, temporary `missing` and grace-period inferred `closed`; parser/transport failures update source health while leaving listings unchanged. Dramatic count drops require explicit acknowledgement before replacing prior truth. |
| G4: Cross-posting identity | Greenhouse posting aliases sharing an internal job ID resolve to one canonical job and application. Manual same-requisition decisions require an explanation, reject uncertain/in-flight applications, retain originals and can be reversed. |
| G5: Historical suppression | Previewed JSON/CSV records are owner-scoped and content-idempotent. An explicit owner submission assertion creates `HISTORICAL_SUBMITTED`, cancels duplicate queued work and never increments receipt-confirmed totals. Document names alone do not prove submission. |
| G6: 403/429 behavior | Connector and repository tests prove 403 pauses only the affected source; 429 persists bounded `Retry-After`/exponential backoff. Neither response rotates identities, credentials or network origins. |
| G7: Live read-only vacancy | On 2026-09-17 at 09:03:22Z, the fixed Greenhouse public board endpoint for Adyen returned HTTP 200 with 227 postings. Posting `8179613`, internal job `3403352`, requisition `JR_4539`, was normalized as `Python Software Engineer, Knowledge Infrastructure`, Amsterdam, NL, with source locator `jobs[110]`. The captured page SHA-256 was `cb91df70709f03afdd9da0ce328d66638ee40cadd8f3380dd364514d3658c589`. A private temporary workspace displayed the vacancy and hash in the owner UI with zero browser errors. No submit action occurred. |

## Checks

- Biome and strict TypeScript checks pass.
- Full unit/integration run: 105 passed, zero skipped, using SQLite and PostgreSQL.
- Browser suite: six passed across desktop and mobile Chromium. Screenshots for
  source health and vacancy evidence were visually inspected; no measured horizontal
  overflow or uncaught page error remained.
- Production build and public-source scan pass across 93 files.
- Production dependency audit reports no known vulnerabilities.
- Migration v4 passes clean and populated upgrades on both database engines while
  retaining application identity and audit history.
- Remote Windows, Linux and PostgreSQL CI: pending implementation commit.

## Security And Correctness Boundaries

Discovery uses only fixed HTTPS Greenhouse/Lever API origins. It sends no cookies or
credentials, follows no redirects, validates resolved addresses as public, caps each
response at 8 MiB and a scan at 32 MiB/60 seconds, and renders source text without
HTML interpretation. Unknown hosts, URL credentials, custom ports and private or
reserved destinations are rejected. Raw public responses remain in owner-scoped
private persistence; only minimal date/count/hash metadata is committed here.

Greenhouse Job Board and Lever postings support is discovery-only. It does not imply
permission or capability to inspect, fill or submit employer forms. Connector schemas
can drift; health and quality warnings fail closed around previously known listing
truth. Location vocabulary is intentionally small, role families are coarse, and an
unknown value remains unknown.

No CAPTCHA handling, anti-bot evasion, proxy rotation, logged-in scraping or final
application action exists in P04. Final clicks remain a P08 gate and require a
supported adapter, active standing authorization, durable intent, receipt correlation
and private live verification.

## Public API References

- [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html)
- [Lever postings API](https://github.com/lever/postings-api)
