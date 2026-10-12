# Automatic Categorical Form Regression Proposals

2026-10-12. Browser preparation and pre-dispatch drift now feed the existing
owner-scoped regression proposal workflow. No new publication or submission
authority is introduced.

Preparation captures an unsupported required control only when a blocked
result contains an actually unresolved unsupported field. It derives one
categorical proposal per adapter/version, not per vacancy or retry. Valid
pre-dispatch aborts capture only the known mock/Recruitee/Greenhouse form-drift
reasons, deduplicated by reason. Generic errors, adapter identity changes and
dispatched/unknown outcomes are not guessed into a form-fingerprint case.

Only enumerated public fixture templates enter proposal data. Labels, values,
URLs, source fingerprints, packets, application identifiers and employer/candidate
text are not copied or hashed into these behavior events. Fact-correction
capture keeps its existing private event digest and immutable reviewed history.
The template's schema field reviewed is not approval of the observed event:
proposal state remains proposed, and the existing owner review/CAS/export guard
must approve it before public import. Repeated events do not reopen a decision.
Both cases already have executable owned-browser regression consumers.

Capture uses the caller's transaction and owner lock. A failed proposal write
rolls back its browser state/preparation or pre-dispatch state/audit change.
Integrity validation applies even to duplicate events. Audit payloads contain
only the category, with system:regression attribution for automatic behavior.

Unknown control kinds now also block READY persistence, canonical answer
approval and new commit intents, including optional unsupported controls and
legacy ready rows. The canonical guard removes their entries and records them
as unresolved, so readback alone cannot make an unrecognized control safe.
The genuine dispatch, revoked policy, duplicate and uncertain-outcome safeguards
are unchanged.

Tests cover privacy, owner isolation, repeated-event deduplication, unapproved
export refusal, rollback on capture failure and zero attempts for blocked forms.
An initial legacy-row test lacked its reviewed fact heads; the fixture was
corrected using the existing seed helper. Its focused rerun passes. Full frozen
successor check then passes 736 tests / 261 skips in 97 files, with lint/types/
ledger/build. Desktop/mobile regression review/export passes 2/2. The newly
compiled production-only Windows installation passes 1/1 (125.97 seconds),
including a fresh Chromium download and the guarded mock recovery workflows.
The independent owned-process sampling draft is not included in these 97 files.
Successor CI is pending; local PostgreSQL cases remain skipped and need that lane.

Limits: capture is categorical, not private page replay or a learned portal
adapter. Broad automatic letter-claim/mail/correction capture and truthful
variant generation remain open. No scoring weight, interview probability or
policy change is applied. No real employer, model, mailbox or private profile
was accessed. P16 remains in progress.
