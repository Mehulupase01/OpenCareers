# P10 Closeout

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
P10 gates G1-G5 are complete and locally verified; G6 and G7 are not started, and
P08-G6 remains `blocked_external` on a private receipt. This plan closes P10
without depending on that receipt.

## Decision Boundaries

- Only the submission package may arm a final application action. No plan,
  inbox action, or resumed session may create commit authority.
- Answer propagation uses the existing exact semantic-key, byte-identical
  meaning, employer, country, valid-date and evidence-revision checks. No
  embedding, fuzzy match, or keyword overlap may propagate a legal,
  work-authorization, sponsorship, salary, demographic, or consent answer.
- The packet generation input must be scoped through the same matcher that
  `CandidateRepository.matchingAnswer` applies at commit time. An answer that
  would be rejected at the commit gate must never reach a fill plan, because a
  filled control is already an answer given to the employer.
- A handoff permits exactly one bounded challenge or login interaction. An
  application-submit control and any employer application POST remain blocked
  for the whole lease, and the broker must be able to prove the block fired
  rather than assume it.
- After completion, automation closes the interactive context, reinspects in a
  fresh owned context, and retains sole authority for the final action. A manual
  interaction that submitted the form must produce reconciliation work, never a
  second automated submission.
- A resumed or rebuilt form is refused while any attempt for that application
  requires reconciliation. Reconciliation is first, always; a rebuild is never a
  recovery path for an ambiguous commit.
- The exception inbox exposes the exact blocker and a supported next action. It
  never exposes a secret, a vault reference, a challenge token, or candidate
  text that was not already the owner's.
- Exception resolution requeues only the affected application. Unrelated queue
  work must remain claimable throughout, and a resolver is not a bypass around
  the gates a task would otherwise have to pass.
- No test may apply to a real employer. The external-adapter handoff is proven
  against an owned loopback fixture that reproduces a challenged hosted form,
  never against a live portal.
- No CAPTCHA solving, challenge-token reuse, fingerprint deception, proxy
  rotation, or anti-bot bypass is part of P10, consistent with masterplan Ch.01
  and Ch.10 and with `docs/amendments.md` item 3.

## Implementation Order

1. **Accounts HTTP surface and owned signup fixture.** `AccountRepository`
   exists but is reachable only from `tests/integration/accounts.test.ts`; there
   is no route and no fixture, so P10 plan step 2 is half delivered. Add
   `apps/api/src/account.ts` with `GET /v1/accounts` (redacted metadata only),
   `POST /v1/accounts` (prepare), and `POST /v1/accounts/:id/signup` (one-action
   dispatch behind the existing permit). Add a `contract` to
   `packages/contracts/src/account.ts` for the request bodies. Extend the owned
   mock ATS in `packages/mock-ats/src/server.ts` with `POST /signup` returning
   success, `422` validation rejection, a dropped response, a duplicate
   account, and a verification-required outcome, so the state machine is proven
   against a server that knows the truth rather than an injected function. Add
   an accounts panel to `apps/web/src/browser-preparation.tsx`. Prove with
   `tests/integration/account-api.test.ts` on both engines and
   `tests/e2e/accounts.spec.ts` on desktop and mobile.

2. **External-adapter visible handoff.**
   `VisibleHandoffBroker.open` hard-rejects any adapter other than `mock-ats` and
   `launchOwnedBrowser` pins the origin to `127.0.0.1`, so a real challenged
   Greenhouse or Recruitee form cannot be resumed today. Introduce an adapter
   capability declaration in `packages/browser/src/adapter-sdk.ts` that names
   the origins a handoff may open, the challenge selectors, and the final-action
   block rule, and make the broker consult it instead of a literal. Add a
   loopback fixture server in `tests/helpers/` that serves a hosted form with a
   challenge element, a hidden final-action POST route, and a clear-challenge
   transition, so the external path is tested with zero employer contact. Prove
   with `tests/integration/handoff-external.test.ts` and
   `tests/e2e/handoff-external.spec.ts`.

3. **Exception inbox.** There is no exception route, list, or resume control, and
   `CandidateRepository.resolveQuestion` is never called from any route or
   worker, so no `ANSWER_UNKNOWN` exception can be created in a running system.
   Add migration v10 for exception metadata, blocker classification, and
   resume bookkeeping. Add `apps/api/src/exceptions.ts` with
   `GET /v1/exceptions`, `GET /v1/exceptions/:id`, and
   `POST /v1/exceptions/:id/resolve` supporting resolve, defer, skip, and
   open-session. Add an Exceptions view to `apps/web/src/main.tsx` showing the
   exact blocker, the affected job, a suggested supported answer when one
   exists, and the next action. Prove with
   `tests/integration/exceptions.test.ts` and `tests/e2e/exceptions.spec.ts`.

4. **Close P10-G6, and fix the scoping defect it will expose.**
   `DocumentRepository` passes every approved answer into the packet
   unscoped, so an answer scoped to another employer, country, or evidence
   revision can reach a fill plan. Route the packet answer set through
   `matchingAnswer` semantics at generation time in
   `packages/persistence/src/document-repository.ts`, and add the
   `question_blocks`-independent scoping check to
   `tests/integration/candidate.test.ts` and
   `tests/integration/documents.test.ts`: near-identical sponsorship wordings
   ("do you require sponsorship" versus "will you require future employer
   sponsorship in NL"), current right to work versus future sponsorship,
   work authorization versus nationality, and the same wording under a
   different employer or country must each resolve independently. This closes
   Appx.B T05 and T06 branches in `packages/matching/src/domain.ts`.

5. **Close P10-G7, safe rebuild.** No rebuild path exists: a completed handoff
   leaves the application in `CHALLENGE_REQUIRED` and nothing re-runs
   preparation, and `SubmissionRepository.begin` does not require the
   preparation to postdate the handoff, so an expired handoff can leave a stale
   preparation usable. Add reconciliation-first refusal in
   `packages/persistence/src/browser-repository.ts` mirroring the predicate
   `SubmissionRepository.begin` already applies, require a preparation newer
   than `handoff_sessions.completed_at` in
   `packages/persistence/src/submission-repository.ts`, add an
   application-scoped rebuild task with a deduplication key in
   `packages/persistence/src/repository.ts`, and expose
   `POST /v1/browser/rebuild`. Write the race tests the plan requires:
   human interaction against a worker lease, revocation between handoff
   completion and rebuild, expiry during rebuild, and a final action racing a
   rebuild. Prove with `tests/integration/rebuild.test.ts` and additions to
   `tests/integration/handoff.test.ts` and
   `tests/integration/documents.test.ts`.

6. **Account and session exceptions.** `blocker: "login"` is produced by
   `packages/browser/src/greenhouse-inspect.ts` and mapped to no exception
   state, and a commit classifies `422` as definitive and everything else as
   unknown, so an expired employer session is indistinguishable from a network
   fault. Add an account-exception outcome to the adapter contract, bound
   retries, and surface it in the inbox. This closes Appx.B T32.

7. **Record the missing remote verification.** The handoff-lease and
   visible-handoff checkpoints have a local count in `docs/HANDOFF.md` but no
   cross-platform run id, and the ledger previously cited one CI run id as
   evidence for two different gates. Run CI for the completed increment, record
   the run id per checkpoint in the ledger `remoteVerification` array, and
   update `docs/evidence/P10-security-checkpoints.md`.

## Acceptance Mapping

| Gate | Satisfied by |
| --- | --- |
| P10-G1 signup stores credentials safely, never in prompts or logs | Step 1 extends the existing vault and redaction coverage to the new routes |
| P10-G2 a lost signup response does not create a second account | Step 1, against a fixture that actually drops the response |
| P10-G3 CAPTCHA/MFA yields a usable handoff while other work continues | Step 2, with the queue-independence assertion retained |
| P10-G4 handoff handles expire, are owner-bound, cannot control another session | Steps 2 and 5, including the new origin allowlist |
| P10-G5 interaction and automation cannot race the final submit | Steps 2 and 5, race tests in step 5 |
| P10-G6 resolving one answer does not propagate to differently worded legal or sponsorship questions | Step 4, the packet scoping fix plus the near-identical wording matrix |
| P10-G7 a resumed expired form is rebuilt safely, ambiguous prior commit reconciled first | Step 5, the reconciliation-first refusal and the five race tests |

## External Gates

None. Every P10 gate is satisfiable against owned fixtures and loopback servers.
This plan deliberately does not require the P08-G6 live receipt, so P10 closure
is independent of whether external submission is enabled.

## Traceability Gaps Closed

- **T22** owner manually submits during handoff: step 5 writes a reconciliation
  record instead of only refusing, and `serverApplicationCount !== 0` is tested.
- **T32** browser session token expires: step 6.
- **T05, T06** unknown sponsorship and salary-threshold branches: step 4.
- **R08** continue around challenges and missing information: step 3 makes an
  exception actionable rather than a count on a metrics tile.

## Out Of Scope

No CAPTCHA solving or anti-bot bypass. No live employer submission, account
creation, or employer-facing POST from any test. No P08-G6 work, and no claim that
any adapter is live-verified. Existing handoff sessions are not migrated; the
migration is additive and does not alter credential or receipt history.
