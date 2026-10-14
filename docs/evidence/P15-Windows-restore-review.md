# Windows Restore Review, 2026-10-14

Scope: Windows recovery engineering for P15-03/G4. This is synthetic evidence,
not a private recovery, employer receipt, physical reboot or soak. No new phase
or gate is claimed complete; totals remain 12/19 phases and 98/128 gates.

## Behavior

Legacy raw-checksum restores no longer substitute restore startup for an unknown
backup capture time. Even after all application reviews, release fails closed
until a capture boundary is persisted. Encrypted archive restores already supply
their conservative capture-start timestamp; their workflow is unchanged.

An owner-authenticated, strict-body backup-boundary endpoint accepts only the
matching open run/snapshot, an ISO UTC lower bound, an evidence SHA-256 and explicit
verification. The backup must be captured AT OR AFTER this bound, not before it;
history review must start AT OR BEFORE the bound. This direction matters: an upper
bound could omit earlier external actions. Owner checks and writes serialize with
the existing owner transaction lock. The boundary cannot be replaced, including
same-value replay, or bound on a foreign/completed run. Future/post-restore bounds
fail. Counts/hashes/owner attestation are audited without private evidence content.

Release rejects malformed persisted capture dates as well as missing ones. Review
must cover the boundary through at least restore startup without future evidence.
Existing correlated-receipt validation, permanent quarantine, credential/session
revocation and paused controls remain authoritative. No new submission engine or
automatic resumption is introduced.

Controls > Backup recovery now exposes run history, immutable checksums/boundaries,
legacy verification, individual receipt/quarantine reviews and final external-history
review. Missing boundary/pending application reviews disable release. Server-side
checks remain mandatory regardless of UI state. Refused receipt evidence surfaces
an error; it does not advance local review state. Completed runs remain read-only
in this screen. Existing receipt upgrades after completion remain API-supported.

## Verification

The initial focused six-file run passed 69 tests with 13 PostgreSQL-only skips.
That run preceded the final lower-bound field naming clarification and web screen;
final validation follows. Frozen full-suite run: 861 passed / 285 skipped,
107 passing files / two skipped in 337.27s. Lint, types and ledger checks passed.
The redirected PowerShell wrapper reported nonzero despite successful stages;
production build was independently rerun with explicit native exit propagation
and passed. Existing Promise<any> lint and large web-chunk warnings remain.
Full browser suite: 76/76 passed in 5.3 minutes, including four legacy/archive
recovery cases across desktop and narrow viewports. Screenshots were visually
inspected without overlap or horizontal overflow. Browser routes are synthetic
UI fixtures; repository/API integration tests independently exercise actual
authorization, immutable binding, receipt validation and persistent quarantine.

The previous commit-crash matrix (3c9d637) passed all four CI lanes in run
38535777122: Windows, Ubuntu, PostgreSQL and server-image.

## Limits

The evidence hash and lower bound are owner attestations, not independently proven
backup provenance or mailbox completeness. If no reliable lower bound is available,
keep the restore blocked. A raw copied database without a restore marker still
cannot be reliably distinguished from an ordinary installation. No private startup,
migration, mail/model/employer request or credential change was performed.

Nested open-restore archives still fail closed. Remote-provider revocation/rotation,
unexpected active-browser/transaction kills, parent/OS interruption, physical Windows
reboot/recovery and actual qualifying 24/72-hour soaks remain separate requirements.
