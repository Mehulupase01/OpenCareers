# P02 Persistence And Recovery Verification

2026-09-16. Local implementation, acceptance checks and remote verification pass.
All test data and endpoints are synthetic.

## Acceptance Evidence

| Gate | Evidence |
| --- | --- |
| G1: Exclusive claims and application commit ownership | `concurrency.test.ts` races four separate Node processes against each engine. Domain case admits two distinct domains; application case admits exactly one submission task despite twelve tasks on different domains. The stored application fence matches the winner. |
| G2: Recoverable preparation | `durability.test.ts` kills a worker with SIGKILL after durable claim, advances lease time and verifies replacement ownership with a higher fence. Repository tests reject stale completion and renewal. |
| G3: Uncertain submission recovery | SIGKILL after a persisted IN_FLIGHT attempt produces UNKNOWN application/attempt and reconciliation, not another submission. Cancellation and duplicate queued task tests preserve this rule. |
| G4: Idempotent outbox | State and audit/outbox writes share a transaction. Consumer failure rolls back the database effect; acknowledged events are not delivered again to the same consumer. External network side effects are outside this transactional contract. |
| G5: Engine parity | The same repository and multiprocess suites pass against real SQLite and PostgreSQL. No PostgreSQL test was skipped in the recorded local run. |
| G6: Migration preservation | Both engines upgrade an isolated populated schema from v1 to v2, retaining application identity and exact audit rows. Checksums, gaps and newer schema versions are rejected. |
| G7: Storage failures prevent dispatch | Real SQLITE_FULL rolls back all writes. Read-only writes fail, unavailable storage prevents task acquisition/dispatch, and API readiness becomes unavailable. PostgreSQL self-termination preserves the original 57P01 error even when rollback fails; a new connection remains usable. |

## Results

- Node 24.21.0; better-sqlite3 12.11.1 with SQLite 3.53.2; PostgreSQL 17.9.
- Unit/integration suite: 51 passed, zero skipped, zero unhandled errors.
- TypeScript strict check and Biome recommended lint/format: passed.
- Production build, public-source scan and refreshed desktop/mobile browser tests:
  passed (2 browser tests).
- GitHub run [35062361432](https://github.com/Mehulupase01/OpenCareers/actions/runs/35062361432)
  passed Windows, Linux and PostgreSQL jobs at
  `9084eb9baa25f87e53c4f54691795e514d203db2`.
- Tests exposed and fixed SQLite auto-rollback error masking and an unhandled
  PostgreSQL checked-out connection error. Neither failure is treated as success.
- Owner control changes retain their initiating actor and monotonically increasing
  revision. Cancellation is idempotent, owner-scoped and invalidates worker leases.
- Definitive pre-commit failures enter the exception queue without automatic retry.

## Verification Boundary

The in-flight fixtures persist synthetic attempts but do not contact an ATS or
execute a browser final click. P02 proves storage/queue prerequisites; P08/P15 must
retest these failures across every external commit boundary with the mock ATS.
There is no live-submission or exactly-once external-delivery claim here.

PostgreSQL connection handling follows the official
[client error lifecycle](https://node-postgres.com/apis/client) and
[pool release contract](https://node-postgres.com/apis/pool).
