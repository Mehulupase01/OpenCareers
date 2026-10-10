# P18 Personio XML Discovery

2026-10-10. Discovery only; no application adapter or phase closure.
The [published XML integration](https://support.personio.de/hc/en-us/articles/207576365-Integrate-jobs-from-Personio-into-your-website-via-XML)
and [wire structure](https://developer.personio.de/docs/retrieving-open-job-positions)
are the reference. Only enabled feeds are usable. Global selects `.com`, EU
selects `.de`; no redirect, credential or employer API fallback is attempted.

The exact configured tenant's `/xml?language=en` is fetched using pinned public
DNS and bounded credential-free GET. XML is validated with the existing parser
library; declarations of DTD/entities, excess nesting, malformed wire fields,
unexpected roots and duplicate posting IDs fail closed. A documented empty root
is valid but still subject to the repository's count-drop and closure controls.
Typed position IDs, complete snapshots, dated raw evidence and identity enter
the same leases, deduplication and evidence pipeline as the other connectors.

Office text and description blocks are retained. Secondary offices are not
normalized in this variant. Creation timestamps are not invented publication
timestamps; publication/update dates remain unknown. Coverage reports public
discovery, with inspection/commit/receipt/reconciliation planned, no adapter
version and no inferred account or challenge support.

## Dated Read

- Endpoint: `https://personio.jobs.personio.de/xml?language=en`
- Observed: `2026-10-10T21:26:35.395Z`; HTTP 200, 1 normalized posting.
- SHA-256: `d3fc39d51dadf5ce5372d59ad6d02353d17f8fa20d597a5e3bcfa457403478de`.
- Raw response and normalized listings retained in ignored isolated probe DB
  `.cache/personio-public-read-KZCzbc/evidence.sqlite`.
- Reusable read-only probe: `corepack pnpm exec tsx scripts/probe-public-source.ts personio personio eu Personio`.
  It creates a fresh isolated evidence database, never reads `.env` or opens the
  private application database. It performs no inference or application action.

Focused initial checks: 36 passed, 2 PostgreSQL skipped across Personio, Ashby
and existing discovery fixtures. Full local check: 417 passed, 152 PostgreSQL
skipped, 51 files; lint, typecheck, ledger and build passed. All 50 desktop/mobile
browser cases passed and the mobile coverage screenshot was inspected. Public
scan passed 293 files. Cross-platform CI follows the checkpoint push.
P18-G4 stays in progress: four other new public
families, universal forms and gated adapters remain outstanding.
