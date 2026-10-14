# Offline Windows Backup And Restore

Supported: private Windows local profile, SQLite and local encrypted candidate
sources/artifacts. Not demo, PostgreSQL, S3 or Android. This command never starts,
migrates or resumes the SOURCE runtime. Existing server contracts/tests are retained;
new non-Windows delivery is deferred at the owner's 2026-10-14 request.

## Prepare

1. Use Global Stop, shut down API, scheduler, browsers and workers, and disable
   startup on the old installation. Prevent other writers returning. Wait for worker
   heartbeats to expire. Reconcile uncertain dispatches; never resend. Confirmation
   flags cannot prove offline exclusivity.
2. Review Windows access permissions on an existing non-synced local destination.
   Plaintext database/ZIP staging is briefly necessary. Use a protected account and
   encrypted volume: POSIX mode bits are not a Windows ACL guarantee. Do not use
   cloud-sync folders, network shares or another user's writable directory.
3. Preserve the owner ID and existing vault key separately. Configure a DIFFERENT
   random canonical base64 32-byte key in private `AUTOPILOT_BACKUP_KEY` environment
   or config. Neither key, owner login token, `.env` nor installation config is
   archived. Keep both keys separately recoverable. Never put them in argv or Git.
4. Referenced documents must use encrypted private storage. Missing, corrupt and
   legacy plaintext documents fail closed. Legacy document migration needs its
   separately secured consistent offline backup first.

## Capture

From an installed Windows bundle with production dependencies:

```powershell
node dist/scripts/backup.js capture --config C:\Private\opencareers.env --destination C:\Private\Backups --confirm-offline --confirm-protected-destination
```

In a checkout, use `corepack pnpm backup capture` with the same flags. The command
returns a fresh archive path and file count, never keys. Only `backup.ocb` remains
in a successful capture directory. AES-256-GCM authenticates/encrypts a bounded ZIP
manifest/database/document inventory. The archive is decrypted and checked again
before success. Committed SQLite WAL data is included; source migrations are not
applied. Referenced files cannot be silently omitted.

## Restore

Keep old and new installations offline. Use the SAME owner/vault key and the
archive's separate backup key. The config's existing data directory is not opened
or overwritten by restore:

```powershell
node dist/scripts/backup.js restore --config C:\Private\opencareers.env --archive C:\Private\Backups\generated\backup.ocb --destination C:\Private\RestoreTargets --confirm-offline --confirm-protected-destination
```

Restore authenticates the whole archive BEFORE parsing/extraction, then verifies
database consistency, vault secrets, file checksums and the complete database's
referenced document inventory. A preceding supported schema may be migrated ONLY
in the fresh offline copy. Restore quarantine is persisted before publishing the
returned `dataDir`. `RESTORE-READY.json` records the source database checksum,
backup capture time and restore run. No services start and existing targets cannot
be overwritten.

After success, explicitly set `AUTOPILOT_DATA_DIR` to the returned `dataDir`. Keep
the old installation fenced; never activate both as authoritative runtimes. Starting
the app is a separate reviewed action. Applications remain commit-disabled until
owner-authenticated receipt/quarantine reviews and external-history review finish.
Import post-backup applications absent from the snapshot too. The review interval
must begin no later than `backupCreatedAt` and extend through restoration; the
persisted capture boundary prevents shortening that gap. The owner's evidence hash
is an attestation, not independent proof of mailbox completeness.

Review release leaves submissions paused. Employer accounts remain locked, Gmail
requires fresh consent, source sessions remain revoked, and old signup/verification
handles cannot replay. Reviewed account unlocking is not yet implemented. Nothing
automatically chooses a vacancy, submits or resumes processing.

## Bounds And Interruptions

The dedicated child has a five-minute hard deadline and 256MiB JS heap limit.
Keys travel over private IPC, not argv or child environment. Its OS-only environment
excludes Node injection options and model/mail credentials. On worker failure or
timeout the parent waits for exit and removes only its generated canonical staging
directory. Unrelated files are preserved. Redirected paths and overwrites fail.

Limits: 512MiB database, 10MiB plaintext/document, 5,000 total files, 768MiB stored
payload, 4MiB manifest and 1GiB encrypted container. Unsupported older/future schemas
fail rather than guessing.

Power loss or parent/OS crash may leave protected staging. Never point the app at an
incomplete job. Preserve the source/archive, inspect offline and retry into a NEW
directory. SSD deletion is not secure erasure. Capture refuses a database already
containing an open restore review: complete that review first. Archives with an open
review also fail closed rather than silently replace the prior quarantine. Nested
recovery remains a separate workflow. Vault rekey, credential rotation, Windows reboot/recovery drills
and qualifying 24/72-hour soaks remain separate requirements. Synthetic tests are
not private recovery evidence.
