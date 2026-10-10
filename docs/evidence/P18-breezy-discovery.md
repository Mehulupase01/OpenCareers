# P18 Breezy Public Discovery

2026-10-11 local date. Discovery only; no employer write or application adapter.
Breezy's [career portal documentation](https://help.breezy.hr/en/articles/5307157-customizing-your-career-portal)
describes published positions and embedding. The observed tenant `/json` route
is a public publishing surface, not a documented employer API contract. No claim
of a published stability, pagination or atomic snapshot guarantee is made.

Read-only HTTPS GETs use the existing public-DNS-pinned transport. Only exact
tenant `/json` and recognized `/p/{posting}` routes are allowed, without query
parameters, cookies, credentials or redirects. Typed listing identities must
match tenant, URL and ID. Vacancy HTML is parsed inertly with parse5; exactly one
JobPosting JSON-LD record must match title, URL and organization before its
description is accepted. Scripts and resources are never executed or fetched.
The list is reread after details; any byte change fails the scan. Limits are
198 jobs, 200 requests, 60 seconds, 32 MiB total and 8 MiB per response. Primary
location only. Unsupported, oversized, denied or drifting scans retain evidence
and fail rather than ingest a partial snapshot or close absent jobs.

## Retained Public Read

- Tenant: `https://codebase.breezy.hr/json`.
- UTC interval: `2026-10-10T23:18:01.767Z` to `2026-10-10T23:18:07.545Z`.
- Seven normalized jobs with full descriptions; nine HTTP 200 responses.
- Initial/final list SHA-256: `73d431801d66ed8a1896df453c3c0f8590b59b919b510557e9dba5b3c1bc4a06`.
- Raw bodies and normalized listings: ignored `.cache/breezy-public-read-gRaIfR/evidence.sqlite`.
- Command: `node --import tsx scripts/probe-public-source.ts breezy codebase global Codebase`.

No candidate profile, private database, OpenRouter call or real submission was
used. Tests cover identity drift, malformed/ambiguous/missing details, duplicate
IDs, moving lists, bounds, blocked routes and access failures. SQLite and
PostgreSQL contract tests exercise dated evidence and deduplication, with
PostgreSQL execution delegated to CI when no local test URL is configured.
Milestone verification results are recorded in the handoff.
