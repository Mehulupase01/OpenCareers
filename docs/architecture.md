# Architecture

One TypeScript workspace contains `apps/web`, `apps/api`, `apps/worker`, and eventually
`apps/browser-worker`. Packages own contracts, configuration, domain rules,
persistence, discovery, candidate evidence, ranking, inference, documents, adapter
contracts, submission, integrations and observability. Create packages when they
have working behavior; empty folders are not delivered features.

## ADR-001: Authoritative state

Accepted. The database owns applications, tasks, authorizations, intents, attempts,
receipts and audit/outbox records. Workers claim durable tasks transactionally with
fencing tokens. Preparation can retry; a persisted in-flight submission requires
reconciliation. No database transaction spans browser navigation or inference.
Events are at-least-once notifications and do not grant authority.

## ADR-002: Persistence parity

Accepted. SQLite on non-synced local disk uses WAL, FULL synchronous durability,
foreign keys and a busy timeout. Startup checks the actual embedded engine version
for the WAL-reset fix. PostgreSQL uses explicit transactions and row locking.
Backend adapters own dialect differences, migration locks and connection lifetimes.
The same repository contract suite must run against both real engines.

## ADR-003: Browser commit authority

Accepted. Only the deterministic submission engine may arm a one-use commit
capability. Intent binds owner, application, origin, requisition, form fingerprint,
answers, artifact hashes, adapter, profile and authorization revision. Persist the
attempt before the final action. Receipt correlation establishes confirmation.
Leases cannot recall already-sent requests; uncertainty remains explicit.

## ADR-004: Facts and inference

Accepted. Immutable reviewed profile versions and fact provenance govern generated
claims. Model outputs are typed proposals and cannot grant permissions. A single
gateway checks every price dimension, privacy setting and capability, reserves
quota durably, then sends minimized data. Unknown pricing fails closed. Paid fallback
is disabled. Deterministic templates remain subject to the same claim validation.

## ADR-005: Deployment profiles

Accepted. Demo uses synthetic data and permits only the owned mock ATS. Local runs
on Windows with SQLite and local encrypted artifacts. Server uses PostgreSQL, TLS,
isolated browser workers and S3-compatible artifacts. Hybrid retains server-owned
state and uses expiring, authenticated outbound browser commands. There is one
committing authority during profile migration; drain and reconcile before switching.

## ADR-006: Small runtime and current tools

Accepted. Node 24 LTS, TypeScript, Fastify, React, Playwright, Zod, better-sqlite3 and
pg. Exact resolved versions live in package.json and pnpm-lock.yaml. Use explicit
repository SQL with separately owned engine migration/claim behavior. Temporal,
Redis, Kubernetes, vector storage and open-ended agent graphs are deferred until
measured requirements justify them. Bounded graph orchestration is evaluated in P12.

## Milestones

P00-P02 foundation; P03-P05 evidence/discovery/ranking; P06-P07 packets and dry run;
P08 verified submission; P09-P11 coverage/accounts/email; P12-P14 unattended and
deployment; P15-P17 security, outcomes and release. P08 retains a required live
receipt gate even when missing credentials allow independent engineering to proceed.
