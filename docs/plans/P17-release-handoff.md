# P17 Release, Portfolio, and Autonomous Maintenance Handoff

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
This depends on P16's calibration report and every earlier evidence file; a
private installation making authorized real submissions remains blocked on
P08-G6, which has never been satisfied.

## Decision Boundaries

- Publish only synthetic material. No real credential, CV, browser session,
  private receipt, recruiter message, or candidate-specific policy enters the
  repository or any release artifact. The scan in `scripts/public-scan.ts` must
  pass on the built artifacts, not only on the working tree.
- Never relabel an adapter. Mock-only, fixture-tested, dry-run-tested, and
  live-verified are distinct support levels. A date and a receipt back the
  top level and nothing else does.
- Distinguish three different things in every document: what was measured, what
  was demonstrated synthetically, and what was requested as a target. A target
  is never reported as an observation.
- Keep exactly one authoritative application database per profile. A release
  that migrates state must move identity, packets, policy versions, and
  receipts, and a rollback must never resurrect a stale ledger over newer
  external applications.
- Fail closed on restore. If a restored database is older than real external
  applications, commits stay blocked through the P15 `restoreBlocked` path
  until an owner reconciles the gap. Never ship a release that resumes
  submission against an unreconciled ledger.
- Do not rewrite history or amend the private masterplan copy. The masterplan
  PDF stays out of source control because it carries the candidate policy
  section; the audit references chapters and appendices by identifier only.
- Do not delete an inconvenient evidence file. Superseded evidence is marked
  superseded with a pointer to its replacement.
- Keep the public clone runnable with zero private configuration. A clean-room
  reader must reach the synthetic demo, the tests, and the build without an
  OpenRouter key, an employer account, or hosting access.

## Implementation Order

1. Release artifacts. Produce versioned Windows and server packages with
   SHA-256 checksums, pinned lockfile, migration instructions, and a rollback
   plan that preserves the application ledger or disables commits until
   reconciled. Verify the checksums and the public-source scan over the built
   artifacts, not the tree, and record the result in
   `docs/evidence/P17-release-bundle.md`.
2. Release notes and honest metrics. Write
   `docs/evidence/P17-release-notes.md` with three separated sections for
   measured results, synthetic demonstrations, and requested-but-unmet
   targets, each item naming its evidence path or stating plainly that none
   exists. Do not carry any figure forward that no evidence file supports.
3. Public repository finalization. Complete `README.md`, the architecture and
   ADR set in `docs/architecture.md`, setup guides for demo, local, server,
   and hybrid, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, upstream
   attribution, issue templates, and the adapter support matrix in
   `docs/adapter-support.md` with support level and last-tested date per
   family. Verify every documented command and path in
   `tests/integration/docs-check.test.ts`, which fails on a link, script, or
   file that does not exist.
4. Operator runbooks. Write `docs/runbooks/` covering the eight operator
   situations this system actually creates: first run and profile selection on
   Windows; account signup and the challenge handoff; unknown-outcome
   reconciliation; policy, mode, and authorization change including immediate
   revocation; backup, restore, and the restore-blocked path; server and
   hybrid deployment with profile migration; adapter and portal drift
   response; and incident containment including emergency stop. Each runbook
   states its precondition, exact command, expected evidence, and what the
   operator must not do. Exercise each in `tests/integration/runbooks.test.ts`,
   which runs the documented steps against a synthetic profile.
5. Synthetic demonstration. Produce a reproducible end-to-end demo through the
   mock ATS covering fit explanation, truthful packet generation, an actual
   mock submission, correlated receipt evidence, crash recovery, and a
   challenge handoff, driven by `scripts/demo-reset.ts` and verified in
   `tests/e2e/release-demo.spec.ts` on desktop and mobile projects. The demo
   must not apply to a real employer.
6. Clean-room verification. From a fresh clone on a clean machine, follow only
   the published instructions to install, run the demo, run the tests, build,
   deploy the server profile to a local stack, and complete a backup and
   restore. Record what worked, what needed a hidden file, and what failed in
   `docs/evidence/P17-cleanroom.md`, and fix the instructions before claiming
   the gate.
7. Maintenance plan and final ledger sweep. Write
   `docs/maintenance.md` covering dependency updates, model-catalogue refresh,
   source and adapter drift review, Netherlands work-authorization rule
   refresh, incident handling, and the recurring regression check cadence.
   Then reconcile every P00-P18 ticket and gate in `docs/phase-ledger.json`
   against its evidence path, marking each unmet external prerequisite
   `blocked_external` rather than `not_started` or `complete`.

## Acceptance Mapping

- P17-G1 "A new user can install and run the synthetic demo from published
  instructions." `docs/evidence/P17-cleanroom.md` from a fresh clone, plus
  `tests/e2e/release-demo.spec.ts`.
- P17-G2 "The private installation can make authorized real final submissions
  on live-verified adapters." This gate depends on P08-G6 and on P13's live
  ramp. It cannot be closed by any artifact produced here and is recorded as
  `blocked_external` in `docs/phase-ledger.json` with its unmet prerequisites
  named.
- P17-G3 "Local, server, and hybrid deployment behavior is documented and
  verified at the claimed level." `docs/runbooks/`, the deployment section of
  `README.md`, and `docs/evidence/P17-cleanroom.md` citing P14's
  `docs/evidence/P14-deployment.md` at its actual verification level.
- P17-G4 "All R01-R12 requirements have a final evidence entry or a clearly
  scoped external verification status." The R01-R12 table in
  `docs/masterplan-traceability.md` updated in increment 7, cross-checked
  against `docs/phase-ledger.json`.
- P17-G5 "No critical security/correctness issue remains open." P15's
  `docs/evidence/P15-security-gate.md` with an explicit residual-risk list, and
  a final pass of the P15 adversarial suites on the release commit.
- P17-G6 "The repository and release artifacts contain no real credentials,
  personal CVs, browser sessions, or private receipts." The scan in
  `scripts/public-scan.ts` run over the built artifacts, recorded in
  `docs/evidence/P17-release-bundle.md`.
- P17-G7 "The release notes distinguish actual benchmark results from targets
  and synthetic demonstrations." The three separated sections in
  `docs/evidence/P17-release-notes.md`, asserted by
  `tests/integration/docs-check.test.ts`.

## External Gates

P17-G2 is the phase's blocking external gate and cannot be manufactured: a
private installation making an authorized real submission needs a reviewed
private profile, an active matching standing authorization, an appropriate
current vacancy, and a genuine private receipt. P13's live ramp and P11's OAuth
client are also outstanding, and P15-G6's 72-hour soak must have actually run.
The clean-room pass in increment 6 needs a genuinely clean machine that is not
the author's development box, and a server deployment needs real hosting
credentials, neither of which exists in this repository. If any of these is
unavailable, the phase ships with the gate marked `blocked_external` and the
limitation stated in the release notes. Nothing here may be closed by a
simulated stand-in.

## Traceability Gaps Closed

- R12, "Publish a reproducible, sanitized GitHub project", is covered to P01
  and its release limb is this phase: the versioned bundle, checksums, the
  completed public documentation set, and the maintenance plan.
- No `Appx.B` scenario is closed here. This phase makes the remaining gaps
  visible rather than closing them, and it must carry T01, T04, T05, T06,
  T10, T29, and T30 forward in the release notes as known partials alongside
  the still-missing live receipt behind P08-G6.
- R11's release limb is documentation and verification at the level P14
  actually achieved, never one level higher.

## Out Of Scope

This phase does not add functionality, adapters, or phases. It does not attempt
to satisfy P08-G6, does not perform a real employer submission, does not
rewrite or supersede a prior evidence file, and does not commit the masterplan
PDF or any private candidate policy. Documentation that overstates a
verification level is a failure of this phase, not a formatting problem.
