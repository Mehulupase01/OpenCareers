# P09 Portal Breadth Amendment

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
P09 closed at `a3233bf` with six of six gates complete against three families:
the owned mock ATS, Recruitee, and Greenhouse. This amendment does not reopen any
P09 gate. It records that the breadth the masterplan contemplated in P09-02 and
which the owner reinforced by conversation has been moved into a dedicated
phase, so that a closed, CI-verified phase is not reopened by new work.

## Decision

The masterplan P09-02 names Recruitee, Greenhouse, Lever, and Ashby as the next
families "normally", and P09-05 asks for a support matrix with per-stage coverage
and last-tested dates. The masterplan Ch.07 further states that the next adapter
should be built for the highest-value repeated opportunity rather than for the
longest list of platform names, and that Workday and similar account-heavy
portals are backlog items with precise reasons rather than checked boxes.

Adding eleven families to a phase whose gates are already verified would weaken
that evidence. Breadth is therefore tracked as phase P18, which depends on P09
and P10, and this amendment exists so the ledger and the audit trail show where
the work moved rather than leaving P09 appearing unfinished.

## What Moves

| Work | From | To |
| --- | --- | --- |
| Owner-account sources and a universal hosted-form engine | P09-02 scope note | P18-01, P18-02, P18-03 |
| Public-API families: Ashby, Teamtailor, SmartRecruiters, Workable, Personio, Breezy | P09-02 | P18-04 |
| Account-gated families: Workday, SuccessFactors, iCIMS, Jobvite, BambooHR | P09-02 and Ch.07 backlog note | P18-05 |
| Support matrix regeneration from the coverage repository | P09-05, already complete | P18-06 step, extending the existing report |

## Decision Boundaries

- P09 gates G1 through G6 stay complete with their existing evidence. No P09
  evidence file is edited to claim coverage that P18 has not yet delivered.
- A P18 variant does not inherit P09's support level. A family added under P18
  starts at `planned` and earns `fixture_tested`, `public_read`, or
  `dry_run_tested` only from its own evidence.
- The adapter contract proven under P09 is not modified to accommodate a new
  family. If a family needs a contract change, that is a P09 amendment with its
  own regression proof, because the contract is what P09-G6 verified.
- Owner instructions of 2026-09-28 override the masterplan's Ch.02 logged-in
  scraping exclusion for the owner's own accounts, per `docs/amendments.md`
  item 1. P18 carries the resulting constraints. The CAPTCHA, challenge-token,
  fingerprint-deception, proxy-rotation, and anti-bot exclusions of Ch.01 remain
  in force and are not overridden.

## Acceptance Mapping

This amendment has no gate of its own. P09-G1 through P09-G6 keep their existing
evidence. New coverage gates are P18-G1 through P18-G7.

## External Gates

None for P09. P18-G1 and P18-G3 require the owner's confirmation of which
accounts may hold a logged-in session, recorded in P18.

## Traceability Gaps Closed

None. This document records a scope decision; it closes no Appx.B scenario and
changes no R01-R12 status. R01 and R06 widen only when P18 delivers.

## Out Of Scope

No change to the P09 adapter SDK, no change to P09 gate evidence, and no
claim that breadth exists before P18 implements and verifies it.
