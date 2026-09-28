# P10 Closeout Checkpoint

Audited 2026-09-28. Records the P10 closeout increments delivered at
`497ca21`, `b9bb03c`, `17036b8` and the answer-scoping increment below. P10
remains in progress: P10-G7, the exception inbox, and the account-exception
mapping are not done.

## Account HTTP Surface And Owned Signup Fixture

`AccountRepository` had a complete one-action state machine and was reachable
only from a unit test. `GET /v1/accounts`, `POST /v1/accounts` and
`POST /v1/accounts/:id/signup` now exist behind the existing owner
authentication, returning redacted metadata only. The identity is stored as a
digest, so the dispatch call supplies it again and it must hash to the identity
the account was prepared with; a mismatch is refused before any permit is taken
and leaves no attempt record.

The bundled mock ATS gained `POST /signup` with five outcomes: success,
definitive validation rejection, an employer duplicate, an account created but
still gated behind email verification, and an account the employer really
created while the response is lost. The last is the one that matters: the test
asserts the server-side account count is 1 while the local record says
`unknown`, and that a second dispatch is refused with `DUPLICATE_SUSPECTED`
rather than creating a second account. An account awaiting email verification
now records `needs_verification` rather than `active`; that state existed in the
contract and nothing produced it.

Two properties are enforced rather than assumed. A non-loopback origin requires
external submission to be enabled, so a demo or default local profile can only
ever write to the bundled mock ATS. A private profile with no vault key still
boots, with every account route failing closed and the rest of the API
unaffected.

## External Adapter Challenge Handoff

The broker previously hard-rejected any adapter other than the owned mock ATS,
and its browser pinned the origin to loopback, so a real challenged Greenhouse or
Recruitee form could be detected and recorded but never resumed.

Each adapter now declares a handoff capability: how the browser reaches the
page, the selector identifying the outstanding challenge, and the paths that are
the final application action. The security model deliberately avoids an
employer-host allowlist. The only URL the broker may open is the exact URL an
already-verified preparation inspected and fingerprinted, re-checked by the
handoff repository against the adapter identity and target fingerprint. A second
list of allowed hosts would be a weaker source of truth that could drift from
the adapter set.

Cross-origin subresources, including challenge iframes, are allowed because a
real widget needs them. A cross-origin write, a cross-origin top-level
navigation, and any non-GET request to a declared final-action path are refused,
and the challenged URL is stripped from the `Referer` header. The proof is
server-side: a loopback fixture counts what actually arrived, and after the
owner clears the challenge and submits anyway, that counter is still zero.

## P10-G6 Answer Scoping And Propagation

The defect: `DocumentRepository` passed every approved answer into the packet
unscoped, so an answer approved for one employer, country, date or evidence
revision could reach another employer's fill plan. The commit gate would have
caught a mismatched answer, but only for a question already recorded in
`question_blocks`, and a filled control is already an answer given to that
employer.

`CandidateRepository.scopedAnswers` now filters by employer, country, validity
window and live evidence revision, and packet generation uses it. Meaning is
deliberately not applied there, because meaning can only be checked against a
real form question; that remains the commit gate's job. The two checks are
complementary rather than duplicated.

The propagation matrix proves that a resolved answer does not leak. Each of
these is a plausible work-authorization or sponsorship question, and none
resolves from the answer to another: the same key with different wording, the
current-authorization question worded three ways, future sponsorship, and
nationality and ethnic origin. The scoping matrix proves an answer approved for
one employer, or one country, or outside its validity window, or resting on
superseded evidence, is never offered for another job.

## Defects Found And Fixed Alongside

Browser tests were running against the owner's private database. The Playwright
web server invoked the dev supervisor, which loads the private `.env`, so a
local browser run started a local profile against the real candidate data, and
`reuseExistingServer` attached to an already-running private instance without
complaint. The web server now refuses to reuse a listener, starts with the env
file skipped and the profile forced to demo, and a global setup refuses to run
unless the server on the test port reports profile `demo`.

The handoff broker browser test hardcoded an absolute session expiry of
`2026-09-28T20:10:00.000Z`. The broker enforces absolute expiry, so the suite had
silently started failing on any run after that instant. The timestamps are now
derived from the clock.

## Verification

`pnpm check` passed: lint, typecheck, ledger validation, 214 tests with 70
PostgreSQL-only skips, production build. `pnpm public:scan` passed over 226
files. `pnpm audit --prod --audit-level high` found no vulnerabilities. All 40
desktop and mobile browser workflows passed from a fresh synthetic reset.

The browser suite is not hermetic and its failures are not deterministic. Specs
share one demo database and one worker, and several depend on a fresh eligible
application existing. Across repeated full runs on a freshly reset workspace,
different specs failed on different runs: `mock-ats` response-loss on desktop,
`documents` on mobile, `accounts` on desktop. Each passed when its file was run
alone, and the observed cause was a five-second default expectation on an app
shell that loads several endpoints before rendering. That expectation is now
realistic in the new spec, and the last full run passed 40 of 40, but the shared
state and shared worker remain a real fragility. Per-spec isolation is Stage D
work and this checkpoint does not claim the suite is stable.

## Boundary

No employer account was created, no employer-facing request was made, and no
real challenge was cleared. The external handoff is proven against a loopback
fixture reproducing a challenged hosted form. The Greenhouse and Recruitee
capability declarations name the challenge selectors and final-action paths
their current public forms use and still need the normal variant-drift check
against a read-only inspection of a real posting. P10-G6 is closed on the
evidence above; P10-G7, the exception inbox, and the account-exception mapping
for an expired portal session remain open.
