# Typed Rejected-Letter Regression Capture

Engineering checkpoint,2026-10-14. P16-04/G6 remain in progress; this is not a
phase closure, a model-quality improvement measurement or live employer evidence.

## Atomic Private Capture

The existing letter compiler emits a typed CLAIM_UNSUPPORTED error for six
distinct reasons: changed_vacancy, unsupported_motivation, invented_quantity,
other_employer, duplicate_contribution and unapproved_evidence. Existing refusal
messages and claim checks remain; no message-text matching classifies errors.
Invalid JSON/schema, route/quota/privacy failures and unmapped final packet
validation failures do not masquerade as a particular rejected claim.

LetterDraftRunner passes only the enumerated reason into existing inference
completion. MatchingRepository validates the category and failed error code,
requires an actual sent packet_drafting or repairs allocation, and captures a
private regression proposal inside the same owner-locked transaction as the
failed reservation, bounded metrics and audit. A capture failure rolls back the
completion; the sent request remains consumed and is never released for reuse.
No raw model response, prompt, candidate fact, employer, URL or message is passed
to the regression repository. Existing inference accounting retains its normal
hashes/code/metrics, not the rejected prose.

Proposals deduplicate per owner and categorical reason, bounding this automatic
catalog contribution to six entries regardless of failed-request volume. Repeated
failures do not reopen dismissed proposals or approve proposed ones. The existing
revisioned explicit review/export boundary remains mandatory. Categorical fixture
reviewed:true is the existing fixture format, not permission to bypass proposal
approval or the maintainer's --publish-reviewed import requirement.

## Executable Publication

Approved export uses the existing strict schema, canonical bytes and checksum.
Publication remains a separate explicit maintainer command into the approved,
unredirected fixtures directory. Private source identities/text cannot become
fixture fields, filenames or CLI output. Legacy invented_quantity fixtures remain
valid. The consumer now exercises the exact typed quantity rejection, not a
different unsupported-prose refusal under a misleading category.

Each discovered public fixture has its own bounded test case; adding fixtures no
longer expands one aggregate browser-test timeout. All six claim variants also
run through the real letter compiler with fixed synthetic data on every suite.
The joined workflow tests and final verification results are recorded below when
complete. No model, employer or mailbox request is needed to execute these cases.

## Verification

Initial focused run:52 passed /22 local PostgreSQL skips, with one aggregate
fixture timeout under concurrent browser load. After splitting discovered cases,
the corrected six-file run passes63 /22 local skips in13.79s. Types and changed-file
lint pass. Joined SQLite workflow19/19 passes with19 PostgreSQL cases awaiting
CI; this covers all six reasons through failed-request accounting, private proposal,
reviewed export, hash-named temporary-repository import and exact typed validator
execution. Repair accounting, deduplication without reopening dismissal, owner
isolation, capture rollback and noncategorical/wrong-allocation/state refusals pass.
No sent request is reissued by rollback recovery. Frozen full check953 passed /314
local skips,111 passing files /two skipped,364.55s. Lint, types, ledger, production
build and237-component native SBOM pass. Public-source scan passes522 files.
An independent read-only agent review finds no actionable scoped defects; that is
static review, not independent runtime evidence. Focused desktop/mobile browser
checks6/6 pass42.6s (regression review/export, outcome history and cumulative reports).
The preceding full browser baseline78/78 remains separately identified. CI pending.

## Remaining Scope

Verified employment workload corrections and blocked-form/pre-dispatch drift
capture already exist; see P16-private-regression-proposals.md and
P16-automatic-form-regressions.md. Broader corrected dates/languages/metrics,
mail-classification correction proposals, family-specific form regression
variants and unmapped packet-validation failures remain explicit work. No claim
that every possible owner correction is covered, no automatic fixture publication,
and no new application database or final-submission authority is introduced.
