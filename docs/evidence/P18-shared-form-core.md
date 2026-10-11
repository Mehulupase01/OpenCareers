# P18 Shared Hosted-Form Preparation Core

2026-10-11. Fixture-verified preparation primitives, not generic live submission
support. P18-G2/P18-02 are in progress until owner-policy-bound application/API
integration and operator views are completed.

`inspectHostedForm` pins the exact approved HTTPS vacancy URL and supplied job
identity. Exactly one visible native form is required. Labels, aria-label and
aria-labelledby map only full name, email, phone and portfolio to packet facts.
DOM-provided semantic keys are not trusted. Duplicate meanings, unknown even
optional controls, hidden/disabled/read-only controls, file uploads, custom
widgets, sensitive questions, login and challenges stop preparation. GET forms
and cross-origin actions are unsupported. Fingerprints include target, action,
method, labels, DOM identity and native constraints, not candidate values.

`fillHostedForm` verifies packet validity and vacancy identity, recomputes the
exact packet-backed plan and checks the canonical answer guard before and
during filling and after readback. All page network requests are blocked while
low-risk filling runs, including potential GET side effects. Network attempts
prevent readiness. Controls are reread at the end, detecting later changes to
previous values, and native validity must pass. No submit/next click, upload,
commit capability or external application record is involved.

Greenhouse now shares native text/email/tel/textarea/select/checkbox fill and
readback plus the existing read-only write barrier. Its own exact adapter,
packet/approval, upload-byte and final-dispatch checks remain unchanged.

## Verification

- Full frozen local check before the last generic-only native-constraint checks:
  497 passed, 157 PostgreSQL skipped across 59 files; lint/types/ledger/build passed.
- All 58 desktop/mobile browser cases passed, including mock final dispatch,
  receipts, unknown outcome reconciliation and challenges.
- Final targeted hosted/Greenhouse fill and commit suite: 26 passed across three
  files; final typecheck passed. Two new cases cover native pattern failure and
  label/input-type mismatch. Do not present 499 as a full local run.
- Public scan before this evidence file: 311 files passed; dependency audit clean.

The next integration must bind target approval to owner policy and existing
preparation persistence/exception views. This primitive is not registered as a
SubmissionAdapter and cannot make arbitrary portals submit-capable. Files,
multi-step navigation, custom controls and sensitive answers require separately
reviewed variants, not relaxation of the generic low-risk mapper.

## Preparation Guard Hardening

2026-10-11. The canonical database answer guard now rejects emergency stop and
preparation pause before another fill. Submission-only and discovery-only pause
remain independent; already-dispatched actions are not claimed recalled.
Restore quarantine and current packet/profile/authorization checks remain.

Production Greenhouse preparation and guarded commit pass that canonical guard
through the low-level fill driver. It reinspects structure and rechecks authority
before every field and after inspection, then rereads all controls, native
validity and exact CV bytes before reporting readiness. Later script overwrites
of earlier values cannot survive as stale successful readback. Low-level fixture
calls cannot establish database authority; no generic submission adapter is added.

Owner stop/cancellation errors retain their control classification rather than
becoming adapter form drift and quarantining an otherwise unchanged family.
Changed answer approval remains fail-closed form drift. Regressions cover a
mid-fill guard revocation, later-input overwrite, all four independent control
settings and guard-error classification. Full local check before the final
classification cases: 595 passed / 204 PostgreSQL skipped, 72 files, build/lint/
types/ledger passed. Final focused suite: 37 passed across five files.
Remote hardening CI still needs recording after push. P18-G2 remains in progress
until policy/API/persistence/operator integration is complete.
