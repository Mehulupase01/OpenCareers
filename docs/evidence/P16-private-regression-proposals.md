# Private Correction Regression Proposals

## Workflow

A verified employment workload correction automatically creates a private,
owner-scoped categorical proposal in the authoritative database transaction.
The hook compares the latest earlier verified fact, not the intervening
unverified edit. Initial verification, unreviewed edits, unchanged workload and
repeat verification do not create proposals. If proposal persistence fails,
the fact review, audit/outbox and head change roll back together. Event digests
deduplicate retries without retaining source facts in proposal rows.

Proposal data contains only the strict public fixture schema: workload category,
before/after full_time or part_time and a review marker. Candidate identifiers,
employer/title/description, dates, private provenance and original text are not
stored in that data or exported. Opaque event hashes stay private and are not
included in catalog/export responses. Original facts remain in the existing
private fact ledger, not in Git. Proposal state, not the fixture's eventual
review marker, governs publication eligibility.

An authenticated owner must separately approve or dismiss the proposal with
revision CAS and an acknowledgement. Final decisions cannot be reversed by a
stale retry. Exact decision retries are idempotent and audited once. Proposed
and dismissed cases cannot be exported. Catalogs are bounded and integrity
checked; fact history over 1000 revisions fails instead of silently truncating.

The Outcomes workspace supports review, approval, dismissal, history refresh and
download. Export bytes match the displayed fixture hash and contain no proposal
ID. Existing `pnpm regression:import PATH --publish-reviewed` now accepts both
reviewed correction JSON and exported schema-version-1 fixture JSON. Both are
strictly validated; unknown schema versions/private fields fail. The explicit
maintainer acknowledgement, fixed output location, bounded input, path/link
refusals, exclusive write and byte-exact idempotence remain mandatory. No public
file, commit, push or application is created automatically by fact review.

## Verification

Full local check passes 705 tests / 255 prerequisite skips in 93 files, plus
lint/types/ledger/build. Focused export/import, proposal and redaction checks
pass 8 / 3 PostgreSQL skips after adding versioned fixture import. API tests
execute owner authentication, publication refusal and exact export digest.
Repository tests execute real fact edit/review/capture, prior verified attribution,
repeat-review suppression, owner isolation, immutable decisions, tampering,
dismissal and persistence-failure rollback. Seeded private-shaped sentinels never
appear in proposal storage or exported fixture bytes.

Successor full desktop/mobile browser verification passes 68/68 (4.4 minutes).
The isolated production-only Windows install passes 1/1 (23.33 seconds total).
PostgreSQL and successor CI are pending.
Browser cases use production handlers in an isolated synthetic owner database,
not shared candidate/source mutation. No private owner runtime, data source,
credential, model/mailbox call, real submission or elapsed soak was used.

The initial browser run passed 67/68: a missing table scroll wrapper obstructed
the mobile review checkbox. Corrected affected workflows passed 4/4. The initial
extracted Windows self-test then failed twice at preparation. Direct isolated
diagnostics found a calendar mismatch: fixture answers start on the Amsterdam
day but canonical validation used the UTC date. This is a production defect,
not a packaging/mixed-build conclusion. Candidate fact/profile/answer validation,
worker generation, preparation inference, chronology display and owner question
resolution now consistently use the existing Amsterdam day helper. Authorization
instants remain UTC and immutable history is not rewritten. New boundary tests
prove validity and expiration over ordinary, spring and autumn day transitions,
including expiry blocking the existing commit gate. The full local check above
includes these tests. The corrected mobile table screenshot is inspected and
row-height/page-overflow assertions pass. Focused boundary and preparation
integration checks additionally pass 22 / 22 PostgreSQL skips after the shared
date alignment. Public-source scan passes 433 files.

## Remaining Scope

Automatic capture currently covers verified employment workload corrections,
not every candidate fact category or rejected model claim. Broader form/adapter
and mail correction proposals remain, as does their executable public fixture
breadth. Existing categorical letter/mail importer cases still work but are not
automatically proposed by this hook. P16-04/G6 remain in progress until that
scope and cross-platform evidence are satisfied; no phase closes here.
