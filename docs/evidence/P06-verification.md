# P06 Verification: Evidence-Bound Document Packets

Verification date: 2026-09-25

P06 prepares reviewable packets from a current approved profile, a vacancy
assessment and standing authorization. No employer submission is claimed.

## Implemented Surface

- Strict claim, CV, letter, answer, report and manifest schemas bind the exact
  profile, assessment, authorization, template and source fact revisions.
- Deterministic generation orders employment evidence before projects, keeps
  full-time professional and total hands-on experience separate, and defers
  substantive answers lacking approved evidence.
- An independent validator rejects unsupported summaries, upgraded project delivery
  status, changed identity or employment facts, placeholders and employer drift.
- ATS-readable DOCX and PDF render from the same AST. Extraction checks equivalent
  content, document structure, pages and text bounds; PDFs embed Noto Sans.
- Migration v6 and the private content-addressed store retain immutable versions.
  Changed artifact hashes invalidate packet readiness and uncommitted intent.
- The worker, protected API and Documents workspace expose packet history, source
  comparison, evidence rationale, answers, validation, downloads and PDF preview.

## Evidence

| Gate | Evidence |
| --- | --- |
| P06-G1 evidence-linked claims | `tests/unit/documents.test.ts`; unsupported summary regression |
| P06-G2 prototype status | Delivery-upgrade rejection test |
| P06-G3 experience totals | Distinct professional/hands-on assertion |
| P06-G4 bounded readable PDFs | Long two-page CV test, PDF extraction and visual preview screenshots |
| P06-G5 format equivalence | DOCX/PDF extraction equivalence test |
| P06-G6 hash invalidation | `tests/integration/documents.test.ts` on SQLite and PostgreSQL |
| P06-G7 deterministic fallback | Deferred-answer and approved-answer tests, worker browser flow |

Synthetic golden artifacts and QA report are in `docs/evidence/goldens/P06`.
Desktop review and PDF preview screenshots are in `docs/evidence/screenshots`.
DOCX bytes were checked across a two-second wall-clock delay; golden regeneration
produced byte-identical artifacts.

Local lint, typecheck, production build, public scan and production dependency audit
pass. A fresh synthetic workspace passed all 10 desktop/mobile browser workflows.
The local suite passed 101 tests; 48 PostgreSQL cases were skipped because the local
Docker service could not start without administrator privileges. GitHub Actions run
`36191355705` passed Windows, Ubuntu and the required PostgreSQL contract lane at
`d1deed7361ae75433065fd125739ab7621dac607`. The complete matrix contains 149
tests and 10 browser workflows on each operating-system lane.

## Boundary

The sample packets and screenshots contain synthetic candidate and employer data.
Private candidate documents, employer account access, and a live authorized
submission are not configured. P07 supplies the mock ATS and filling contract;
P08 owns final commit authority and receipt reconciliation.
