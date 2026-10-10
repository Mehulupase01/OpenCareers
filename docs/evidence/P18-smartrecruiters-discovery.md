# P18 SmartRecruiters Public Discovery

2026-10-10. Discovery only, not an application adapter or phase closure.
Reference: [public Posting endpoints](https://developers.smartrecruiters.com/docs/endpoints),
[PUBLIC destination and pagination](https://developers.smartrecruiters.com/reference/v1listpostings),
and [posting detail objects](https://developers.smartrecruiters.com/docs/objects).
No employer API credentials, internal postings, application API or logged-in
session is used. Only the exact public list and numeric posting-detail paths
are admitted to the pinned, credential-free public transport.

Each list uses destination PUBLIC, limit 100 and an explicit offset. Descriptions
come from separate fixed-company posting GETs, never arbitrary ref/apply URLs.
Offset, total, page size, unique IDs, active details, company and hosted posting
identity must agree. Every list/detail response has dated raw evidence and a hash;
the normalized job points to its detail evidence page. Scan limits are 200 requests,
60 seconds and 32 MiB, with 250 ms between requests. Capacity/deadline exhaustion,
missing details or detected shifts fail the whole scan; they never ingest a
partial snapshot or close existing jobs. Large boards need future resumable
discovery. Consistent counts are not a guarantee of an atomic upstream snapshot.

## Dated Read

- Company: Sana Commerce; 6 normalized postings with full descriptions, 7 responses.
- First observed: `2026-10-10T21:34:06.256Z`, final detail `2026-10-10T21:34:08.976Z`.
- List URL: `https://api.smartrecruiters.com/v1/companies/SanaCommerce/postings?destination=PUBLIC&limit=100&offset=0`.
- List SHA-256: `49f403fad1e0326e0d2102a0ad86b78c1d80ced6b536aded53a4278eb46a7854`.
- First detail `744000154020834` SHA-256:
  `946f144e787b5ed95458f3172800ec5585e3bc4020808f63ffc0a3c5d189ae11`.
- All raw list/detail responses, individual hashes and normalized listings are
  retained in ignored isolated `.cache/smartrecruiters-public-read-jOR3xc/evidence.sqlite`.
- The documented `smartrecruiters` sample company returned zero public postings;
  retained separately in `.cache/smartrecruiters-public-read-5n8KHa/evidence.sqlite`.
- Probe: `corepack pnpm exec tsx scripts/probe-public-source.ts smartrecruiters SanaCommerce global "Sana Commerce"`.

Focused SmartRecruiters/coverage checks: 22 passed, 3 PostgreSQL skipped. Unit
fixtures include two-page traversal, shifting totals, capacity/deadline failure,
duplicate/company/detail drift, ignored malicious refs, inactive/missing detail,
and refused internal or employer API routes. SQLite/PostgreSQL integration tests
prove repeated-scan deduplication, dated evidence and no closure on failed details.
Final focused regression check: 51 passed, 12 PostgreSQL skipped across six files.
Typecheck, lint, ledger, build and public scan (297 files) passed. All eight
desktop/mobile discovery cases passed, including the three new families and
the existing evidence/history/identity workflow; mobile screenshot inspected.
The full browser and PostgreSQL suite runs in checkpoint CI. P18 remains
open; three other public families, universal forms, owner ingestion and gated
application families remain separate requirements.
