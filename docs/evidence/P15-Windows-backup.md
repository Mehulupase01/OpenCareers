# Windows Encrypted Backup And Offline Restore

2026-10-14. Implements private local SQLite plus referenced encrypted source/artifact
files. No private data, config, vault, CV, employer, model or Gmail service was opened
or called. All development/restore evidence uses isolated synthetic temporary data.
The prior recovery commit85dbce1 passed all four lanes in CI38489655882, including
PostgreSQL. The owner subsequently requested Windows-only delivery; new Android and
server/hybrid work is deferred without marking original requirements complete.

## Workflow

`pnpm backup` and the installed bundle's `node dist/scripts/backup.js` provide
capture/restore with explicit offline and protected-destination confirmations. The
command loads config but never calls the operational database bootstrap. A dedicated
256MiB-heap child receives keys over IPC, an OS-only environment, no Node injection
options and a five-minute hard deadline. Parent timeout waits for exit and removes
only its newly allocated canonical staging directory; unrelated files survive.

Capture uses the existing WAL-aware read-only native snapshot and verifies owner,
schema history and integrity. The snapshot's database inventory determines every
source/artifact path; no recursive sweep of private files, `.env`, config or keys.
Document authenticated owner/purpose/checksum/length and stored vault secrets are
checked using the existing codecs. Staged files enter a stored-entry ZIP with a
strict manifest. A separately derived AES-256-GCM backup key encrypts the entire ZIP
with owner/format-bound AAD and a random nonce. Capture decrypts and verifies the
result again, then removes protected plaintext staging; only backup.ocb remains.

Restore authenticates the complete envelope BEFORE parsing ZIP entries. It rejects
unsupported compression, directories/symlinks, duplicate/unknown entries, path
redirection, unsafe manifest paths, count/size excesses and checksum mismatches.
The extracted database's full referenced inventory must match the manifest. Its
schema/checksums/consistency, document contents and stored secrets must validate.
Only a fresh offline copy can be migrated; source databases and archives remain
unchanged. Quarantine revokes signup/mailbox/source authority before atomic publication
of the returned data directory. No API/worker/browser starts automatically.

The capture boundary is taken BEFORE source reads, persisted on the restore run
by an append-only migration and recorded in RESTORE-READY.json. A known boundary
cannot be replaced. Release refuses an attestation starting after the backup even
if it includes restore startup. Legacy manual restore markers without a capture
boundary retain their existing weaker attestation behavior; they are not equivalent
to this verified archive workflow.

## Evidence

Focused snapshot/archive/restore/bundle contracts:50 passed /eight skipped, five
files,21.23 seconds before the final adversarial database-content case. Tests include
source main/WAL preservation, encrypted document round-trip, no config inclusion,
new targets, wrong keys/owners, header/nonce/body/tag corruption, append/truncation,
authenticated malicious inventories, omitted referenced files, checksum mismatch,
missing/corrupt/legacy documents, source schema preservation, restored-only migration,
immutable gap boundaries, stale capabilities, command execution without key output,
Node injection exclusion and timed-out-worker cleanup preserving unrelated files.
Full frozen `corepack pnpm check` passes:849 tests /279 local skips,105 passing files
/two skipped,283.33 seconds. Lint, types, ledger and production build pass, with the
existing browser-helper lint warning. Public-source scan passes496 files before
this final handoff update. A separate compiled-command smoke passes without tsx:
synthetic database plus encrypted artifact captured/restored, artifact verified,
stopped and restoreBlocked both true. It used only fresh synthetic storage, removed
after verification. Successor hosted CI remains pending for this new commit.

P15-G5 closes for the current supported Windows local profile: database consistency
and referenced source/artifact checksums are verified in actual archive restoration,
including authenticated corrupt-database and inventory-omission refusals. This does
not certify deferred PostgreSQL/S3 recovery or close the P15 phase. Totals12/19
phases,98/128 original ledger gates; the deferred non-Windows phase is not completed.

## Limits And Open Work

See included `docs/WINDOWS-BACKUP.md` for commands, bounds and recovery procedure.
Protected local plaintext staging needs reviewed Windows ACLs/encrypted disk; mode
bits are not an ACL verifier. Five-minute process isolation bounds hangs, not all
native memory or power-loss behavior. Parent/OS failure may leave protected staging;
SSD deletion is not secure erasure. Capture/restore of an already open recovery
review is explicitly refused pending a nested-recovery workflow. Legacy plaintext
documents need their separately secured offline migration backup first.

Keys/config are deliberately NOT archived and must be independently recoverable.
Reviewed employer-account unlock, document/vault rekey and credential rotation remain
unfinished. External-history completeness remains an owner attestation. No private
restore, actual reboot/BSOD recovery or qualifying24/72-hour soak is claimed. No phase
closes here; original non-Windows requirements are deferred, not satisfied.
