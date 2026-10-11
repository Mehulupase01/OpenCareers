# Matching History And Browser Regression Breadth

## Compatibility

New assessments emitted by the canonical matching runner record the code-owned
`evidence-matching-v1` pipeline version, including deterministic and paused
results. It identifies the gates, evidence validation, scoring rules and semantic
prompt meaning. Maintainers must bump it when those semantics change. It is not
an immutable upstream model-build identifier or a performance improvement claim.
Existing assessment bytes, digests and packets are not rewritten or retagged.

Fixed review datasets derive compatibility from immutable stored assessments:
model ID, provider, pipeline version and profile ID. Owner review input cannot
supply any of these fields or replace stored scores. Mixed routes, profiles,
known versions or known/unrecorded versions fail atomically. New datasets freeze
this descriptor into the existing hashed data and its compatibility digest.
Catalog, report and exact retry validate both digests and dataset identity.
Subsequent source changes do not rewrite a frozen review corpus.

Earlier fixed datasets still parse without this additive metadata, retain their
original route digest and explicitly report unrecorded pipeline history. New
datasets based entirely on legacy assessments also disclose the missing version;
it is never inferred from the currently installed code. The diagnostic workspace
shows the recorded version or Unrecorded. All reports remain advisory rank/AUC
diagnostics, not selection probabilities or authorization writers. Provider model
names can change behind a route; upstream build reproducibility remains unknown.

## Executable Categorical Cases

The strict reviewed regression compiler/importer additionally accepts:

- `unsupported_form / unsupported_required_control`.
- `adapter_drift / changed_form_fingerprint`.

Only these enumerated categories cross the publication boundary. HTML, URLs,
candidate IDs, unreviewed input, free-form variants and arbitrary extra fields
are rejected. Two manually reviewed synthetic fixtures contain no source form,
candidate or employer material. They are not automatic private form proposals.

The shared fixture consumer runs these through an owned loopback ATS, isolated
dry-run browser, actual packet factory and browser inspector/planner/fill engine.
An unknown required unsupported control stays unresolved, receives no planned
answer and returns needs_input. A changed question changes the inspected
fingerprint and refuses the earlier fill plan. Both cases assert zero accepted
applications and zero attempted final writes; owned resources close in finally.
This verifies the common mock form engine, not all external portal variants or
genuine employer submissions. Existing workload, rejected quantity and ambiguous
mail fixtures continue through their real domain validators.

## Verification

Focused compatibility/matching/rank checks pass 23 tests / 19 PostgreSQL skips.
Focused executable regression/privacy checks pass 7 tests. Full local check passes
710 tests / 257 skips in 93 files with lint/types/ledger/build. Initial focused
browser workflows passed 9/10: the outcome test raced a shared preparation worker.
It now uses an isolated owner database and production handlers rather than shared
state. Corrected affected desktop/mobile workflows pass 10/10 (1.2 minutes),
including unchanged analytical application/control state. Extracted Windows
installation passes 1/1 (23.64 seconds total). Successor CI is pending. No private
runtime, credentials, model/mailbox
calls, real submission or actual-duration soak is used.

P16 remains open. Broader automatic rejected-claim/form/drift capture, truthful
variant generation, authoritative seniority/sponsorship metadata and independent
production acceptance evidence remain separately tracked. No gate closes from
version tagging or two fixture examples alone.
