# P07 Verification: Mock ATS Browser Preparation

Verification date: 2026-09-25

P07 prepares a packet against an owned synthetic ATS. A READY result means the
form was inspected, filled and read back; it does not mean an employer application
was submitted.

## Implemented Surface

- First-party loopback mock ATS with two-step forms, conditional questions,
  asynchronous uploads, challenge and failure fixtures, account records,
  application records and unique receipt IDs. Server records are the test oracle.
- Isolated Playwright Chromium contexts block every off-origin request and every
  non-GET application request in dry-run mode, including implicit form submits.
- Typed form snapshots and structural fingerprints bind job, step, field semantics,
  required flags, option values and answer plans to the immutable P06 packet.
- Text, email, telephone, textarea, select, radio, checkbox, date, file and
  autocomplete controls are filled and read back. A server-accepted upload,
  unchanged form structure and complete required answers are needed for READY.
- Migration v7 stores packet-bound preparation evidence and transitions. The
  Documents workspace shows the dry-run controls, outcome and form evidence.

## Gate Evidence

| Gate | Evidence |
| --- | --- |
| P07-G1 read-back | `tests/e2e/mock-ats.spec.ts` checks exact option values and every filled field; `tests/integration/documents.test.ts` rejects falsified evidence |
| P07-G2 uploads | Mutation observer sees idle, selected, uploading and accepted; rejected upload reports failed |
| P07-G3 conditional | Sponsorship reveal changes the snapshot and requires a new plan |
| P07-G4 changed question | Reusing a plan against changed wording is rejected by fingerprint |
| P07-G5 challenge | Challenge is a scoped typed result; a subsequent job remains inspectable |
| P07-G6 false confirmation | Banner and account creation leave server application count zero; only a valid mock application POST creates a receipt |
| P07-G7 dry-run isolation | Explicit submit, Enter and change-triggered native submit are blocked; server application count stays zero |

Local lint, typecheck, production build, public-source scan and production
dependency audit pass. The local suite passed 102 tests, with 49 PostgreSQL
tests skipped because the Docker service requires administrator privileges.
A fresh synthetic workspace passed 22 desktop/mobile browser workflows.
Desktop and mobile READY screenshots are in `docs/evidence/screenshots`.
GitHub Actions run `36194183542` passed the Windows, Ubuntu and PostgreSQL
contract lanes at `025eaea33b3c37bbd9540faa40ccbd42478dc5ef`.

## Boundary

This is synthetic-only browser preparation. No third-party ATS application
adapter is live-verified, no candidate account is configured, and no real
employer submission is claimed. P08 adds centralized final-click authority,
server receipt correlation and uncertain-outcome reconciliation.
