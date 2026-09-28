# Stage 0 Masterplan Conformance Audit

Audited 2026-09-28 against Job Autopilot Production Masterplan v2.0 and the
repository at `6a4a40894772c03ddaf0795c8d1ac22c2e8b44ea`.

This records the inspection result that produced `docs/masterplan-traceability.md`.
It is an audit, not a verification run: no test was executed, no production
behaviour was changed, and no phase or gate status moved as a result.

## Scope And Method

Four inspections were performed against the working tree:

1. Ledger schema conformance against `Appx.D`, including a filesystem existence
   check on every path-shaped evidence entry.
2. Error vocabulary coverage against the 18 codes required by `Appx.A`.
3. Route registration inventory of every handler in `apps/api/src/`.
4. Outbox and audit envelope shape against the 13 fields required by `Appx.A`.

The masterplan itself is excluded from source control because it embeds a private
candidate-policy section. The audit used an offline copy supplied by the owner.
No masterplan text and no private policy value is committed.

## Registered API Surface

41 routes are registered. The API is organised by bounded context, not by resource,
which is the structural reason `Appx.A` conformance is partial.

| Method | Path | File |
| --- | --- | --- |
| GET | `/health/live` | `apps/api/src/server.ts:114` |
| GET | `/health/ready` | `apps/api/src/server.ts:119` |
| POST | `/v1/session` | `apps/api/src/server.ts:129` |
| DELETE | `/v1/session` | `apps/api/src/server.ts:160` |
| GET | `/v1/operations/summary` | `apps/api/src/server.ts:165` |
| POST | `/v1/control/pause` | `apps/api/src/server.ts:166` |
| POST | `/v1/control/stop` | `apps/api/src/server.ts:176` |
| POST | `/v1/control/resume` | `apps/api/src/server.ts:179` |
| POST | `/v1/demo/probe` | `apps/api/src/server.ts:182` |
| GET | `/v1/candidate` | `apps/api/src/candidate.ts:28` |
| POST | `/v1/candidate/sources` | `apps/api/src/candidate.ts:35` |
| GET | `/v1/candidate/sources/:id` | `apps/api/src/candidate.ts:40` |
| POST | `/v1/candidate/facts` | `apps/api/src/candidate.ts:43` |
| POST | `/v1/candidate/facts/:id/review` | `apps/api/src/candidate.ts:46` |
| POST | `/v1/candidate/profile` | `apps/api/src/candidate.ts:57` |
| POST | `/v1/candidate/answers` | `apps/api/src/candidate.ts:65` |
| POST | `/v1/candidate/authorization` | `apps/api/src/candidate.ts:68` |
| POST | `/v1/candidate/authorization/:id/revoke` | `apps/api/src/candidate.ts:71` |
| GET | `/v1/candidate/authorization/export` | `apps/api/src/candidate.ts:75` |
| GET | `/v1/discovery/coverage` | `apps/api/src/discovery.ts:19` |
| GET | `/v1/discovery` | `apps/api/src/discovery.ts:20` |
| POST | `/v1/discovery/sources` | `apps/api/src/discovery.ts:30` |
| POST | `/v1/discovery/recognize` | `apps/api/src/discovery.ts:36` |
| POST | `/v1/discovery/sources/:id/poll` | `apps/api/src/discovery.ts:44` |
| GET | `/v1/discovery/runs/:id` | `apps/api/src/discovery.ts:53` |
| POST | `/v1/discovery/history` | `apps/api/src/discovery.ts:56` |
| POST | `/v1/discovery/identities` | `apps/api/src/discovery.ts:78` |
| POST | `/v1/discovery/identities/:id/split` | `apps/api/src/discovery.ts:85` |
| GET | `/v1/matching` | `apps/api/src/matching.ts:12` |
| POST | `/v1/matching/jobs/:id/assess` | `apps/api/src/matching.ts:13` |
| GET | `/v1/documents` | `apps/api/src/documents.ts:18` |
| POST | `/v1/documents/generate` | `apps/api/src/documents.ts:19` |
| GET | `/v1/documents/:id/artifacts/:kind` | `apps/api/src/documents.ts:29` |
| GET | `/v1/browser` | `apps/api/src/browser.ts:52` |
| POST | `/v1/browser/dry-run` | `apps/api/src/browser.ts:53` |
| POST | `/v1/browser/recruitee/prepare` | `apps/api/src/browser.ts:72` |
| GET | `/v1/handoffs` | `apps/api/src/handoff.ts:31` |
| POST | `/v1/handoffs` | `apps/api/src/handoff.ts:32` |
| POST | `/v1/handoffs/:id/open` | `apps/api/src/handoff.ts:36` |
| POST | `/v1/handoffs/:id/complete` | `apps/api/src/handoff.ts:51` |

The bundled mock ATS is a test oracle, not part of the public surface. It
registers `GET /jobs/:fixture`, `POST /uploads`, `POST /applications`,
`POST /accounts`, `GET /receipts/:id` and `GET /__test/records`.

## Ledger Findings

All 25 path-shaped evidence references across the ledger resolve to files that
exist. One class of defect was found and is recorded rather than deleted:

- `P10-G1` and `P10-G2` each cite the free-text string `GitHub Actions 36457888701`
  in their `evidence` array. A CI run identifier is real evidence but is not a
  repository path, so it cannot be verified in-repo and one run cannot
  independently evidence two gates. Stage 0.2 moves these into a dedicated
  `remoteVerification` field and requires a path or a labelled run reference.

Structural deviations from `Appx.D`, all closed in Stage 0.2:

- `nextAction` absent on all 18 phases.
- `acceptanceTests` absent; no ticket carries a `T` identifier.
- Tickets are positional `[id, text]` tuples with no status, so a single ticket
  cannot be tracked independently of its phase.
- Ticket text is truncated mid-sentence throughout, which prevents a reader from
  determining which work-package sub-items were dropped.
- Only 3 of the 6 allowed statuses are in use. P08-G6 is `not_started` although
  its prerequisite is external, which is exactly the confusion the
  `blocked_external` status exists to prevent.
- Phase-level `evidence` is optional and absent on 10 of 18 phases.

## Verification

No test suite, lint, typecheck or build was run for this audit. The only check
performed was a filesystem existence test on ledger evidence paths. The
conformance summary this document supports is an inspection result and must not be
read as a green test run.

## Boundary

No code was modified to produce this audit, no gate was marked complete, and no
external request was made. The masterplan was not committed. `blocked_external`
statuses introduced by the ledger migration record a missing private prerequisite;
they are not an engineering claim of completion.
