# P18 Resumable Public Scans

2026-10-11. Read-only discovery engineering; not logged-in source consumption,
unrestricted internet coverage, or an application adapter.

Migration 18 adds public-response checkpoints to the existing authoritative
SQLite/PostgreSQL database. The production worker uses the same connector parsers,
normalization, identity and complete-batch ingest; fixtures retain their existing
path. Each live slice makes at most five GETs, separates transport calls by at
least 250 ms, releases its source lease on a neutral `scanning` yield, and waits
five seconds before another claim. A yield does not increment source failures,
create a completed source run or publish partial jobs.

Records bind owner, source revision, parser/cache version, request ordinal, exact
URL and request ETag. Successful 200/approved-parser 302 responses are bounded by
the existing transport and retained with original UTC fetch timestamps, hashes
and measured serialized byte counts. The source cache is capped at 32 MiB, the
owner's caches at 128 MiB, and generations expire after 30 minutes. Source edits,
manual scheduling, parser/cache changes and expiry invalidate incompatible reads.
Only public response bodies are stored here, never browser cookies or tokens.

The first page and repeated-URL consistency checks always reach the transport.
Previously collected reads must be revalidated before complete ingest; verified
reads can be reused for at most five minutes. A changed body/status/redirect
discards the scan and retains prior vacancies for review. This is a bounded
consistency window, not an atomic snapshot of an external website. Frequently
changing or byte-unstable feeds may not finish, and each parser's original
pagination, storage and time ceilings still apply. Unsupported boards remain
unsupported. Completing every remote board within 20 minutes is not guaranteed.

Pause, emergency stop, restore quarantine and stale source leases fence cached
reads and writes as well as actual network access. Revoked source configuration
cannot publish. 429s retain successful checkpoints and preserve ordinary server
backoff; challenges/access denials are not bypassed. Complete ingest clears scan
records in the same transaction as existing listing freshness transitions.

## Evidence

- `tests/integration/discovery-resume.test.ts`: four bounded slices recover 201
  synthetic Lever jobs with one completed run, no partial jobs or attempts;
  later-page and anchor drift; rate limits; pause/stale leases; revision/expiry;
  malformed durable data; owner isolation; noncontiguous/future/quota writes.
  The actual worker entry point separately completes 500 synthetic jobs through
  bounded slices, with neutral deferral, one completed run and no attempts.
- `tests/integration/discovery-crash.test.ts`: a real child process checkpoints
  reads and is killed with SIGKILL. A new process lease reuses the committed
  prefix, performs only anchor and unseen-page reads, and publishes no partial
  job or application attempt. PostgreSQL equivalents run in CI.
- Frozen full local check before the final transport-spacing/coverage wording:
  588 passed, 199 PostgreSQL skipped, 72 files; lint/types/ledger/build passed.
  Final focused verification and browser/CI results are recorded in the handoff.
  Final runner suite: 10 passed / 10 PostgreSQL skipped. Final spacing/capacity
  suite before the runner addition: 11 passed / 11 skipped. All 58 desktop/mobile
  browser cases passed. Public scan passed 356 files before this final evidence
  addition; production dependency audit was clean. CI 38132000459 at
  `200a4af36121a4366598ced56b3758da2eec82aa` passed all three lanes: 589 tests
  plus all 58 browsers on each OS lane, and 464 PostgreSQL integration tests.

No real board reads, private configuration, live inference or employer writes
were needed for this milestone. P18-G3 remains open: these tests do not establish
permission-bound logged-in ingestion. P18 as a whole remains open.
