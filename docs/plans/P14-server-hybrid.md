# P14 Fully Deployable Server and Hybrid Profiles

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
This depends on P13's unattended runtime and P12's bounded runs; what cannot be
satisfied here is a real hosting deployment, which needs owner credentials and
a real public endpoint.

## Decision Boundaries

- Do not add a fifth profile by widening an existing one.
  `AUTOPILOT_PROFILE` in `packages/config/src/index.ts:6` is exactly
  `demo | local | server`, and hybrid must be introduced as its own validated
  value with its own server base URL, worker registration, and lease settings.
- Keep one committing authority at all times, per ADR-005. Server owns
  authoritative state. The owner's PC in hybrid is a browser worker, never a
  second state store and never a second committing authority. Drain and
  reconcile before any profile switch.
- Never expose database or browser-control ports publicly. PostgreSQL and any
  Playwright control surface stay on a private network; only the authenticated
  API is published, and only over TLS.
- Make hybrid commands expiring, authenticated, owner-bound, single-use and
  intent-bound. Replayed, expired, wrong-owner, and wrong-intent commands are
  rejected before any effect. A command envelope is not authority; the server
  re-runs the full precommit gate for the final action.
- Fail closed when the server is unreachable. Loss of connectivity prevents new
  local commits after the lease and authorization expire, and the local
  browser session is not authoritative in that window.
- Keep secrets out of images. No credential, token, database URL, or storage
  key is baked into a layer; they arrive by environment mount or external
  secret reference, and a restored database never resurrects a revoked
  session.
- Preserve identity across migration. Export and import must carry application
  identity, packet manifests, policy revisions, and receipts unchanged. Where a
  restore is older than real external applications, commits stay blocked
  through P15's `restoreBlocked` path rather than a second mechanism invented
  here.
- Keep the remote handoff narrow. Owner-authenticated, expiring, single-session
  access to one waiting server browser over a reviewed private transport.
  Never expose a raw debug endpoint.
- Keep the server profile's existing guarantees. ADR-002 persistence parity
  still holds: the same repository contract suite runs against PostgreSQL and
  local SQLite.

## Implementation Order

1. Introduce the `hybrid` profile in `packages/config/src/index.ts` with
   validation for the server base URL, worker registration identity, command
   lease TTL, and allowed origins, keeping the loopback restriction for demo
   and local. Prove in `tests/unit/config.test.ts` that hybrid requires a
   server base URL and a PostgreSQL connection string, that an invalid hybrid
   value fails startup with a `CONFIG_INVALID` action, and that server still
   refuses a non-HTTPS origin.
2. Build the server image and Compose topology with pinned browser and runtime
   versions, an authenticated API, health checks, restart policies, and
   non-root execution. Prove in `tests/integration/server-image.test.ts` that
   the built image contains no credential pattern, and run the mock
   end-to-end workflow from the Compose stack.
3. Add the S3-compatible artifact store implementation against the existing
   `packages/documents/src/artifact-store.ts` contract, with encryption
   configuration and checksum verification, keeping the local encrypted store
   on the same contract suite. Prove in
   `tests/integration/artifact-store.test.ts` and a new store-contract lane
   that both backends satisfy one repository contract.
4. Implement the hybrid command transport. New package for command records,
   authenticated delivery, command expiry, replay protection by single-use
   id, owner and intent binding, and receipt acknowledgement, wired into
   `apps/worker`. Prove in `tests/integration/hybrid-command.test.ts` that
   replayed, expired, wrong-owner, and wrong-intent commands are each rejected
   with no external effect.
5. Add the remote handoff route for the single waiting server browser, reusing
   the P10 lease and generation fencing in
   `packages/persistence/src/handoff-repository.ts`. Prove in
   `tests/integration/hybrid-loss.test.ts` that after connectivity loss and
   lease expiry no new local commit occurs, and that an expired remote session
   cannot be reclaimed.
6. Build the profile migration tooling: export, drain active commits, reconcile
   uncertainty, move artifact manifests, import, and reauthenticate where a
   session must not transfer. Prove in `tests/integration/profile-migration.test.ts`
   that application identity, packet manifest, policy revision, and receipts
   survive a round trip, and that an interrupted migration leaves commits
   blocked rather than half-applied.
7. Document and exercise the deployment: TLS termination, authentication,
   backup and restore, and measured resource requirements, published in
   `docs/evidence/P14-deployment.md` with the Compose stack verified end to end
   against the mock.

## Acceptance Mapping

- P14-G1 "A clean server deployment completes the full mock application
  workflow with the owner's PC disconnected."
  `tests/integration/server-image.test.ts` against the Compose stack, with the
  browser worker stopped.
- P14-G2 "Hybrid mode completes the same workflow with a local browser worker
  and server-owned state." `tests/integration/hybrid-command.test.ts` with the
  server holding state and the local machine acting as browser worker only.
- P14-G3 "Replayed, expired, wrong-owner, and wrong-intent commands are
  rejected." `tests/integration/hybrid-command.test.ts`, one case per
  rejection class.
- P14-G4 "Loss of server connectivity prevents new local commits after
  lease/authorization expiry." `tests/integration/hybrid-loss.test.ts`.
- P14-G5 "Database and browser-control ports are not publicly exposed in the
  production profile." `tests/integration/server-image.test.ts` asserting the
  published port set, plus a deployment review recorded in
  `docs/evidence/P14-deployment.md`.
- P14-G6 "Local-to-server migration preserves application identity, packets,
  policy versions, and receipts." `tests/integration/profile-migration.test.ts`.
- P14-G7 "TLS/authentication, backup, and resource requirements are documented
  and tested." `docs/evidence/P14-deployment.md` with the restore leg proven by
  `tests/integration/profile-migration.test.ts`.

## External Gates

This phase's engineering runs entirely against the mock ATS and a local
Compose stack, but a genuine server deployment cannot be fabricated. It needs
owner-provided hosting credentials, a DNS name, a certificate authority path,
a managed or self-hosted PostgreSQL instance, and an S3-compatible bucket, none
of which exist in this repository. P14-G5 as a claim about a real public
endpoint and P14-G7 as a claim about real backup and restore therefore stay
pending on owner access, and no test may assert them against a mock. P13-G7
and P08-G6 also remain `blocked_external`, so a server or hybrid profile cannot
be labelled live-verified from this phase.

## Traceability Gaps Closed

- T27, "Hybrid command replay", recorded `missing` because no hybrid command
  model exists and the config profiles are `demo`, `local`, and `server` only.
  Increments 1 and 4 close it.
- R11, "Deploy in local, server, and hybrid profiles", recorded as not started
  with no evidence. This phase is the whole of R11.
- R12 partial support: a reproducible image and a pinned, documented deployment
  path are prerequisites for the release bundle in P17.

## Out Of Scope

This phase does not add new portal families, does not change submission
authority or the commit interlock, does not introduce a workflow engine,
message queue, or orchestration platform deferred by ADR-006, and does not
implement P15's `restoreBlocked` writer. It does not attempt P13-G7 or P08-G6.
No employer endpoint is contacted by any test written here.
