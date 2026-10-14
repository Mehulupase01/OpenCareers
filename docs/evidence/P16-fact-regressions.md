# Broader Fact-Correction Regression Loop

Engineering checkpoint,2026-10-14. P16-04/G6 remain in progress.

The existing owner fact-review transaction now considers reviewed employment,
language and metric history, using the same bounded1,000-version lookup and
owner lock. Only same-ID/key/kind, increasing, verified and reviewed revisions
can produce correction categories. Initial/unreviewed facts, no-ops and unsupported
edits do not create proposals.

Supported categories are employment workload (existing), employment period
(start/end), language level and numeric metric value. Actual dates, language names,
levels, numeric values/units, employer names, fact IDs, descriptions and provenance
do not enter new public fixture bytes. New strict fact_correction envelopes carry
only employment_period, language_level or metric_value. Existing schemaVersion1,
workload and letter fixtures remain compatible.

A simultaneous workload/period correction produces two categorical proposals in
the same review transaction. Legacy workload event identities are unchanged; new
category identities include their category so they cannot collide with that event
or each other. The singular extraction helper remains compatible, returning the
first supported category; persistence consumes the complete array. Existing explicit
proposal review/export and maintainer publication requirements remain unchanged.

The executable consumer uses fixed synthetic facts and the actual packet validator:
pre-correction date/language/metric content is blocked with CLAIM_UNSUPPORTED under
the corrected facts, while rebuilt content validates. Metric fixture claims are
explicit synthetic typed claims; this does not claim the default generator now
automatically renders metrics. Each imported fixture remains a separate discovered
test case, without real model, employer or mailbox calls.

## Verification

Schema/unit agent focused51 tests pass; changed-file lint/typecheck pass. Parent
consumer and existing proposal checks19 pass /three local PostgreSQL skips in10.79s.
Joined SQLite review/export/import14/14 passes with14 PostgreSQL cases awaiting
CI. It covers all three categories through imported real-validator execution,
privacy sentinels, initial/unreviewed/no-op cases, immutable dismissal and repeated
review. Simultaneous workload/period edits preserve two unique proposal identities
and the legacy workload hash. An injected failure on the second proposal INSERT
rolls back the first proposal, fact review/version and audits; retry then captures
both once. Frozen full check1,011 pass /328 local skips,113 passing files /two
skipped,340.34s. Lint/types/ledger/build/native237-component SBOM pass. Public
scan526 files. Four desktop/mobile candidate and regression-review browser checks
pass38.2s; these complement repository-level new-category coverage, not private
live correction evidence. Successor CI remains pending.

Prior letter commit5b8d172 CI38567488365 passes PostgreSQL, Ubuntu and server-image,
but Windows fails only the SBOM integration test's15-second outer deadline. Its
child has an existing30-second bound and completed after a cold pnpm binary
download in22.95s. The outer test now has45 seconds, preserving the30-second child
bound and all inventory assertions. Focused SBOM integration/unit checks8/8 pass;
the full build above precedes only that test-deadline change. No production timeout
or required inventory check is removed. New CI must pass before claiming parity.

## Limits

This is categorical regression coverage, not storage of a private correction or
proof that all future errors of the category will be detected. Changed identity,
education/project periods, availability/authorization, language names, metric units
or contextual wording are not newly captured. Misclassified forms, portal-family
specific drift and mail corrections remain separate scope. Repeated review cannot
approve or publish fixtures, alter authorization or create an application. No new
database, dependency or submission engine is added, and no phase closes here.
