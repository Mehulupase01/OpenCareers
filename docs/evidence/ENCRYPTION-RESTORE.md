# Document Encryption and Restore Barrier, 2026-10-09

## Delivered

Private API and worker document stores now use versioned AES-256-GCM envelopes.
HKDF derives a document-only key from the vault key. Authenticated metadata binds
owner, source/artifact purpose, plaintext SHA-256 and length. Files have random
nonces; plaintext identities, manifest sizes and download/upload bytes do not
change. Sources are parsed in the isolated parser before encryption. Synthetic
demo/goldens remain explicitly plaintext; no private fallback is permitted.

Missing keys do not prevent dashboard startup, but document reads/writes fail
closed. Legacy plaintext requires an explicit offline migration. Neither case
invalidates a good packet as if its bytes were corrupt. Tampered authenticated
files, wrong keys/owners/purposes, invalid paths and oversized files are rejected.
Artifact publication uses synced temporary files and non-overwriting hard links.

`documents:encrypt` upgrades only the database's owner-scoped source/artifact
inventory. It requires explicit offline and recoverable-backup confirmations,
a vault key and expired worker heartbeats. It stops processing, preflights every
checksum/path/size, verifies each authenticated replacement, replaces atomically
and supports resuming after partial completion. It never changes plaintext hashes
or silently resumes processing. Only counts enter migration audit payloads.

Restore migration adds durable runs and application reviews. Set
`AUTOPILOT_RESTORE_SNAPSHOT_SHA256` before starting a restored private installation:
shared connection initialization persists the barrier before API/worker startup.
Normal controls cannot write `restoreBlocked`. All old leases are revoked, saved
packets/forms invalidated and handoffs cancelled. Uncertain submission attempts
stay UNKNOWN and retain original adapter/payload read-only reconciliation tasks.

Every application present in the backup requires review, including pre-intent
applications: the old installation could have sent it after the snapshot. The
owner can associate an existing correlated, checksum-verified confirmed receipt
or quarantine the application against replay. There is no "assume unsent" action.
Global release also requires an explicit owner attestation that post-backup
external application history has been reviewed/imported, a private evidence hash
and a non-future coverage interval spanning restoration. This is recorded, not
inferred from reviewing snapshot rows. Release leaves submissions paused. Quarantined
applications remain blocked at claim, intent and dispatch boundaries permanently,
unless a later correlated receipt settles the review. New applications can proceed
after separate owner resumption. API reviews are owner-session/Origin protected.

## Operator Procedure

Do not run these commands on an active installation. Shut down all API, scheduler,
browser and remote workers, and prevent the old installation from coming back.
Secure a consistent offline database plus complete file inventory and recoverable
vault-key backup outside the repository. Plaintext legacy backups require encrypted
storage. A confirmation flag is an operator assertion, not an automated backup.

For a legacy document upgrade, preserve the existing vault key, configure the
private profile and run:

```powershell
corepack pnpm documents:encrypt --confirm-offline --confirm-backup
```

Verify reported counts and downloads before explicitly resuming processing. Never
replace the vault key casually: key rotation/rekey is not implemented for documents.
The command is not run automatically on startup or during development.

For restoration, compute the SHA-256 of the consistent offline snapshot, set the
restore checksum configuration before first boot, and inspect `GET /v1/restores`.
Use the owner-authenticated application review endpoint, then the run release
endpoint with `externalHistoryReviewedAndImported: true`, `evidenceSha256`,
`from` (the backup boundary) and `through` (the completed external-history review).
First inventory/import applications created after the backup, including ones not
present in the snapshot. The hash attests to owner-reviewed private evidence; the
current implementation does not independently read that evidence or prove mailbox
completeness. Do not release without that review. Remove the restore checksum configuration only after the review is
recorded; leaving it configured intentionally creates another barrier on the next
post-release boot. Keep uncertain applications quarantined; never resend them.

## Verification

Focused tests cover encryption, owner/purpose/key/checksum binding, header/body
tampering, size limits, private-key absence, encrypted source extraction/deduplication,
concurrent artifact publication, explicit/resumable upgrades, full-inventory
preflight, redirected paths, tenant isolation, audited restore release, lease
revocation, original reconciliation payloads and a real offline SQLite copy/reopen.
Final `corepack pnpm check` passed lint, typecheck, ledger and production build:
41 files, 274 passed and 94 PostgreSQL cases skipped locally. All 42 isolated
desktop/mobile browser cases passed in 2.8 minutes. Public-source scan passed
(255 files before staging), `git diff --check` passed, and production audit found
no known vulnerabilities. PostgreSQL cases run against the dedicated CI service,
not the private database. GitHub run 37857873687 passed Windows, Ubuntu and
PostgreSQL at f93254420f5954fee4b4c1fef95017800bb0ad06.

No private migration, key rewrite, service restart or employer action was performed.

## Open Gates

This checkpoint starts P15 recovery engineering; it does not close P15. Database
facts, extraction text and packet ASTs are still plaintext; this is file/secret
encryption, not whole-database encryption. Whole-installation backups, automatic
restore detection, reviewed restore UI, account-signup/mailbox restore fencing,
encrypted solved-session continuation, rekey/rotation and the full adversarial
crash/restore matrix remain. Heartbeat absence does not prove every browser is
offline; the operator must enforce offline exclusivity. A copied database without
the restore marker cannot be distinguished reliably from an ordinary installation.
There has been no 24-hour or 72-hour soak and no receipt-backed live verification.
