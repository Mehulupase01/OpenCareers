# Recorded Owner Policy Remains Authoritative

P16-G7 is satisfied by the existing recorded-owner-policy path and the verified
analytical/experiment authority boundary, not by automatic policy adoption.

Outcome/cohort/calibration/regression writes persist evidence, reviews and
categorical cases only. Their reports are advisory. Experiment definitions are
strict and reject a policy field; creation, assignment, comparison and stopping
cannot modify standing authorization or change submission controls. A reviewed
variant assignment narrows a dispatch to its exact packet, never authorizes it.

`SubmissionRepository.begin` invokes `CandidateRepository.checkCommit` using the
packet's standing authorization/profile bindings. Dispatch rechecks the active
authorization ID/revision, revocation, expiration, control interlocks and fenced
intent. Existing owner authorization creation records a new policy revision;
revocation immediately pauses commits. None of the P16 repositories is a policy
writer. No report-to-policy mutation or ranking-weight adoption route exists.

Executable evidence includes:

- `experiments.test.ts`: a nested policy is refused, immutable definitions and
  assignments do not alter controls, and no application is created by assignment.
- `calibration.test.ts` and `outcomes.test.ts`: reports/reviews preserve controls
  and cannot create standing authorizations.
- `candidate.test.ts`: recorded policy revision, profile binding, owner scope,
  revocation and canonical commit checks.
- `documents.test.ts`: the actual guarded engine checks stopped/expired assigned
  experiments before intent/dispatch, allows receipt confirmation after dispatch,
  and refuses dispatch after standing authorization revocation. Revocation leaves
  the unsent in-flight attempt blocked/uncertain, not eligible for blind replay.
- Desktop/mobile outcome/calibration workflows assert unchanged application and
  control state using isolated synthetic handlers for their analytical writes.

CI 38180066956 at cfabde72e1954c4b455dc8ebd2259ab79a5c1cce passes Windows, Ubuntu
and PostgreSQL, including the complete browser suite and production-only Windows
installation. That is engineering verification, not a live policy change or live
submission. The successor matching-history and form-fixture batch is not covered
by that run. P16 remains open, including its P15 dependency and other gates.
