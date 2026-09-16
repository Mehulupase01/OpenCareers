# Persistence Contract

SQLite uses the installed better-sqlite3 embedded engine, checked at startup for
the WAL-reset fix. File databases require WAL, foreign keys, FULL synchronous and
a busy timeout. A process-local operation queue prevents unrelated async calls
from entering an open transaction. Cross-process writes use BEGIN IMMEDIATE.

PostgreSQL owns a connection pool and explicit transactions. Migration application
uses an advisory transaction lock and immutable checksums. Queue claims lock the
owner row to serialize the small single-owner scheduling domain, select with
FOR UPDATE SKIP LOCKED, then assign an owner-monotonic fencing token. Other owners
can progress independently. Transactions contain only bounded database work.

Tasks have persistent deduplication keys, attempt budgets, retry timestamps, lease
owners and expiry. Claims enforce total and per-employer concurrency. Expired
preparation requeues within budget; expired in-flight submission becomes UNKNOWN
and enqueues reconciliation. Confirmation cannot be written through the general
state transition method. The submission protocol remains a separate P08 deliverable.

Task acknowledgement reloads the persisted task type, rather than trusting a worker
copy. Submission acknowledgement requires a resolved outcome. Duplicate queued
submission tasks cannot be claimed while their application is uncertain or terminal.
Cancellation revokes leases; cancelling an in-flight submission preserves UNKNOWN
and its reconciliation task. Reconciliation work cannot be discarded by cancellation.
Owner control and cancellation events record the initiating actor. Controls have
monotonically increasing audit revisions.

PostgreSQL clients retain an error listener while checked out, not just while idle
in the pool. Failed rollback does not replace the original failure; broken clients
are discarded. A failed durable write or claim never grants execution authority.

Audit events and outbox records commit with the state change. The transactional
consumer interface is for database-only effects that share the transaction. Never
send network requests in this callback. External consumers must use their own
idempotency records because an outbox cannot make an external service exactly-once.

The integration suite runs the same tests against SQLite and PostgreSQL. The
multiprocess suite starts four actual Node workers and races them against one
owner. A green repository test is not evidence for browser crash recovery; the
mock ATS process-kill matrix will provide that evidence in P08/P15.

See [P02 verification](evidence/P02-verification.md) for the actual acceptance matrix.
