# P04 Discovery, Identity And Historical Imports

Plan prepared 2026-09-17 while P03 remote CI runs. Source: masterplan page 33.
Implementation begins after P03 closure. No submission action is in this phase.

## Decisions

- Start with Greenhouse public Job Board GET and Lever public postings GET (global
  and EU). Add a source by board token or recognized hosted vacancy URL. Arbitrary
  authenticated pages and unknown redirectors remain unsupported, explicitly reported.
- Use fixed HTTPS API origins, checked DNS destinations, no cookies/credentials,
  no automatic redirects, bounded response bodies/timeouts and structured validation.
  Source text is untrusted data and renders as text, never HTML or instructions.
- Greenhouse is a full snapshot. Lever traverses offset pages until a short page,
  including the extra empty page for exact multiples. Validate uniqueness and count
  limits. Commit normalized records and freshness only after the entire scan passes.
  Conditional full-feed revalidation may use ETag; no invented delta API or cursor.
- Persist immutable raw response snapshots/hashes and source runs with duration,
  status, count and parse warnings. Retain bounded recent snapshots, preserving any
  referenced job evidence. Source leases fence overlapping/late poll results.
- Schedule each source durably. 403 pauses it until owner intervention; 429 respects
  Retry-After with bounded exponential backoff. Timeouts/parser errors retain previous
  job truth and health separately. A failed source never pauses unrelated sources.
- Canonical identity uses trusted platform/board/requisition and recognized vacancy
  URLs. Keep original provider posting IDs and raw source locators. Greenhouse internal
  job identity groups multiple posts; public posting IDs remain actionable targets.
  Never merge two positions solely because titles match.
- Maintain source aliases pointing at canonical jobs. Ambiguous duplicate suggestions
  are owner-resolvable and reversible. Identity resolutions retain provenance and do
  not delete attempts/receipts; any uncertain/in-flight work blocks identity changes.
- A successful scan can mark a missing listing temporarily missing, not closed.
  Repeated complete scans over a configured grace interval can mark inferred closure.
  A dramatic count drop or empty/malformed description is a quality warning and cannot
  close prior listings. Preserve closed/missing/parser-failed distinctions in the UI.
- Location keeps source text plus explicit country/city/remote fields. A small
  deterministic Netherlands vocabulary and role alias catalogue is inspectable;
  unknown or ambiguous country stays unknown. Do not infer authorization from location.
- Historical records accept structured JSON/CSV data and document-folder manifests.
  Owner-asserted submitted state suppresses repeat work without becoming CONFIRMED.
  A letter filename is only a document reference, never proof of submission. Imports
  are previewable/idempotent and owner-scoped; no arbitrary server filesystem reads.

## Implementation Order

1. Contracts and normalization: source configuration, snapshots, location, canonical
   keys, recognized URLs, role aliases, history import validation.
2. Connector transport/fixtures: bounded secure reads, pagination/revalidation,
   deterministic replay, parser quality and retry classification.
3. Migration/repository: source leases/runs, canonical aliases, evidence, freshness,
   duplicate resolution and historical suppression. Shared SQLite/PostgreSQL tests.
4. Worker scheduling and protected APIs; source/health/jobs/detail/history dashboard.
   Polling respects global and discovery controls. Discovery never submits a job.
5. Desktop/mobile workflows and adversarial fixtures, then one live read-only source
   import with source evidence displayed. Keep live listing material in private runtime
   storage; commit only minimal source/date/count/hash verification metadata.
6. Build/lint/typecheck/audit/public scan, phase evidence and remote CI, commit/push
   closure, then continue to P05.

## Gates

Repeated polls create no duplicate job/application work; pagination boundary and
conditional responses preserve records; closure does not follow one failed parse;
established cross-postings share application identity; history suppresses repeats
without increasing confirmed counts; 403/429 pause/backoff persists; a real current
vacancy is normalized and displayed with attribution, without submission.

## References

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever postings API](https://github.com/lever/postings-api)

These references establish supported public reading contracts only, not employer
submission privileges or universal coverage. Live verification records exact dates
and board variants. Portal-access amendments remain separately tracked.
