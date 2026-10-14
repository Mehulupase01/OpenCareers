# Correction-Aware Cumulative Outcomes

2026-10-14. Completes the missing cumulative reporting behavior in P16-G3, pending
final frozen/CI verification. No whole phase is closed by this document. No private
career records or genuine employer outcomes were read. All numeric evidence below
is deliberately synthetic arithmetic, not measured hiring effectiveness.

## Immutable Method

New fixed captures retain current-status outcomes unchanged and additionally freeze
`corrected_observed_milestones_v1` evidence. Every eligible member gets a commitment
to its known, bounded outcome history and at most three explicitly observed positive
milestones: SCREENING, INTERVIEW, OFFER. Each retained milestone binds the event ID,
revision, evidence hash and occurrence time. There is no inferred screening from an
interview or interview from an offer. Repeated observations count an application
once per milestone, using its earliest supported occurrence on the corrected branch.

History must have consistent application identity, contiguous revisions/previous
links, unique IDs, valid owner/mail actors, valid timestamps and evidence hashes.
Restoration requires an existing earlier target, matching kind and its exact
decoder-ordered digest. It rebases onto that historical branch, including an
abandoned branch, rather than treating all prior events as independent confirmations.
An explicit UNKNOWN is a conservative milestone-evidence reset, never a rejection.
A subsequent explicit restoration can recover the prior supported branch.

Only events occurring by the fixed member horizon affect that horizon's milestones.
Later restorations do not retrospectively rebase the earlier horizon. Backdated
corrections known to a later capture can affect that new snapshot; they never mutate
an existing one. Raw evidence references/messages are not retained in the cumulative
block or returned in public reports. A hash is provenance, not independent verification
of the owner's claims or the completeness of a mailbox.

The existing receipt-observation horizon, qualified non-mock receipt rules, canonical
job deduplication, capture cutoff and exclusions remain unchanged. Histories are
bounded to1,000 events per qualifying application and100,000 in the entire capture;
overflow/integrity failure aborts the transaction instead of truncating. No new table,
policy revision, score weight, control state or submission authority is introduced.

## Report And Owner Workflow

Outcomes shows separate current-status and cumulative observed counts. The total,
each selected-dimension group and descriptive group comparison carry numerators,
denominators and fractions only above the existing minimum sample, independently
for each group. Counts remain visible below the threshold; rates/differences do not.
The same fixed receipt dates, knowledge cutoff, observation days and global exclusions
remain visible. Applications without positive milestone evidence are explicit and
are not labeled rejections. Group exclusions are not invented from global exclusions.

Saved legacy snapshots are not backfilled or reinterpreted from their last status:
cumulative evidence is unavailable, not zero. Mixed legacy/new cumulative comparison
withholds differences while preserving the separate, existing current-status report.
Unsupported metadata remains UNKNOWN. These descriptive observed fractions are not
selection probabilities, causal effects, statistical significance or automatic policy
recommendations. Full metadata breadth and remaining experiments/regression gates
remain separate P16 work.

## Verification

Two bounded test agents added disjoint history and persistence tests while the main
agent implemented contracts/reporting/UI. Focused five-file check:91 passed /30 local
PostgreSQL skips before the final additional observation-window case. Four targeted
desktop/narrow browser cases passed in46.8s, covering measured cumulative differences,
unknown/legacy refusals and independently insufficient groups alongside the actual
isolated outcome API workflow. Screenshots were visually inspected; the narrow table
uses the existing horizontal scroll container without page overflow. Typecheck/lint
pass with the existing browser-helper warning. Frozen full check:918 passed /295
local skips,110 passing files /two skipped,365.24s. Lint, types, ledger, production
build and native237-component SBOM pass. Full browser and CI results follow.

Synthetic repository fixture:21 receipt-qualified members, a30-day horizon,
receipt window August1 through September30,2026, cutoff October1,2026. Cumulative
counts: screening1/21, interview3/21, offer1/21. Source A has20 eligible and3/20
interviews; source B has one eligible, so fractions are withheld. The browser fixture
uses40 members in two groups of20 to exercise descriptive differences. Neither set
is live employer evidence, a qualifying soak or an improvement claim.

The development launcher now uses a monotonic bounded45-second API-readiness deadline
to tolerate cold Windows imports under compilation load. The previous10-second start
failed before browser execution; the isolated rerun passes and no failed run is counted.
Previous crash-driver commit d0452af CI38543222009 passes all four lanes.
