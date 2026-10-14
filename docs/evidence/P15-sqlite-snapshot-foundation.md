# SQLite Snapshot And Database Restore Foundation

2026-10-13. Database-only protected staging, not a complete production backup.
No private database, credentials or current candidate data were inspected or copied.

`captureQuiescentSqliteSnapshot` opens an existing regular database read-only with
query-only mode. It never bootstraps missing data or applies migrations. Applied
migration order/checksums, the engine's WAL fix, SQLite quick consistency and foreign
keys are verified. Exactly the configured owner must exist. Source controls must
be stopped; active task/poll leases, in-flight attempts and recent worker heartbeats
prevent capture. Explicit stopped-writer and protected-destination review are also
required. These checks supplement operator review; they do not prove that a rogue
or untracked writer cannot exist.

The database's native backup API captures committed WAL changes into a fresh,
generated directory without overwriting an existing destination. Source data-version
changes during transfer reject the result. Transfer progress enforces a30-second
deadline and512MiB size cap; synchronous integrity checks are not independently
wall-clock bounded yet. Source and destination paths refuse filesystem redirection.
The copy is checked again for consistency/schema and hashed by streaming its bytes.
Incomplete generated files are removed only within that newly owned directory.
The generated manifest explicitly records database-only scope, no encryption and
productionBackupAccepted=false. POSIX mode bits are restrictive; Windows ACL/privacy
review is still required, and this plaintext staging must not be sent to cloud storage.

The native backup behavior follows the [better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise),
not copying a live main database file while ignoring WAL. Read-only SQLite may still
use its existing WAL/SHM coordination; no SQL writes, checkpoint or schema migration
is initiated by this component.

## Evidence

Eight synthetic SQLite tests verify WAL-only committed data, unchanged source main
and WAL bytes, hash/size/schema verification, unique destinations, older schema
preservation, no missing-source bootstrap, owner/schema refusal, recent workers and
leases, directory redirection, concurrent-write refusal with cleanup, and restore
into a separate offline database preserving application identity. The existing
restore quarantine blocks its queued submit and replay after ordinary pause flags
are cleared; the captured input remains unchanged. No second active application
runtime or employer action is involved.

Focused snapshot plus existing restore contracts:14 passed /four PostgreSQL skipped
across two files. Types/build/lint and public scan pass. Full successor results are
recorded after verification; counts remain12/19 phases and97/128 gates.

## Remaining Workflow

Implement encrypted complete archives with document/source checksums and integrity
verification, a bounded subprocess entry, interruption recovery, fresh-target restore
before any worker starts, reviewed account recovery, vault rekey/rotation and
PostgreSQL capture/restore. Safe private preflight/activation must use that complete
workflow, not treat this primitive or an operator acknowledgement as release evidence.
P15-G4/G5 and P15-03 remain open; database-only checks do not satisfy artifact backup,
secret portability or complete external-submission-gap reconciliation.

## 2026-10-14 External Capability Quarantine

Restore now locks every non-closed employer account, including prepared accounts
with no recorded signup attempt: the backup may predate a remote signup. Pending
signup intents and dispatches become UNKNOWN with increased fences. Pending and
in-flight verification links become unknown, never replayable. Account preparation,
credential access and signup authorization also consult stop/restore controls under
the owner transaction lock.

Gmail connection generations increase, access-token references and scan cursor
references are detached, leases expire and fresh consent is required. Source sessions
are revoked with increased revisions and detached secret references; poll leases
are cleared. Application-review release does not unlock accounts or restore sessions.
Re-entering an existing open quarantine reasserts these external fences, including
quarantines created by an older build; mailbox generations intentionally advance.
Encrypted historical secret rows are retained, not securely erased or rekeyed.
There is not yet a reviewed employer-account unlock/recovery workflow.

Final focused suite:46 passed /36 PostgreSQL skipped, five files covering snapshot,
restore, accounts, Gmail and source sessions. Verification-link transitions, stale
signup handles, post-release refusal and another owner's unchanged mailbox metadata
are asserted. Local public-source scan passes488 files. Full frozen successor
`corepack pnpm check` passes:838 tests /278 PostgreSQL-dependent skips,104 passing
files /two skipped,265.15 seconds. Lint/types/ledger/build pass; the existing
browser-helper lint warning and web chunk-size warning remain. Clean-installation
and monitored-capacity tests pass. Database-enabled CI remains necessary for
PostgreSQL parity; this is not a live-adapter or complete backup certification.
An earlier broad run overlapped source edits and is invalid: its capacity guard
correctly refused source changes, and newly added restore tests loaded an older
module. It is not used as acceptance evidence.
