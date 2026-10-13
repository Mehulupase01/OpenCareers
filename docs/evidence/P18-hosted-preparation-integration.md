# P18 Owner-Bound Hosted Preparation

2026-10-13. Synthetic engineering evidence, not employer submission evidence.

## Delivered Workflow

The private Documents workspace approves an exact public HTTPS origin with an
explicit low-risk-fill review, an expiry of at most 180 days and revision fencing.
Approval is owner-authenticated; agents cannot supply an actor or grant authority.
Permissions live in the existing authoritative database, are owner-isolated,
audited by hashes, checked for content integrity and revoked during restore.

`POST /v1/browser/hosted/prepare` accepts only a stored packet ID. The worker's
existing inspection task uses the same workflow for approved otherwise unsupported
origins. Both require private enabled execution and a valid immutable packet with
validated LLM-letter metadata. Synthetic LLM drafts in tests are explicit stubs;
these tests make no real provider calls.

Canonical database checks run before public navigation, before and during native
filling, after readback and again inside the preparation persistence transaction.
They retain current profile/fact/policy, stop/pause, restore, duplicate and uncertain
outcome restrictions. Origin approval is rechecked at each guard and at persistence.
Labels are normalized only for recognized generic controls; raw inspected labels
and fingerprints remain in preparation evidence.

An isolated headless browser loads anonymous same-origin resources through the
existing public-address DNS lookup. The loader performs GET only, uses no global
connection agent, follows no redirects, sends no credentials or browser cookies,
rejects compressed responses and bounds resources to 8 MiB and 10 seconds. The
driver additionally bounds the run to 60 seconds, 64 reads and 32 MiB total.
Subframe navigation is refused. Scripts, service workers and downloads are disabled.
Network egress is permanently sealed before candidate values are filled, until
the owned browser closes.

Exactly one visible native form is required. Only recognized full name, email,
phone and portfolio fields can be filled. Unknown even optional controls, ambiguous
labels, unsupported kinds, account requirements and challenges stop filling.
There are no upload, next or submit actions in this route. The inner report can
record successful native readback, but the preparation remains `unsupported` for
final submission. Persistence rejects forced READY and any submission queue for
`hosted-readonly`; it is not registered as a submission adapter.

The private UI exposes approval expiry, prepare, revoke, evidence refresh and
per-field readback. Existing demo preparation and reviewed family routes retain
their own contracts. Generic challenge evidence does not create a handoff capability.

## Verification

- Focused loader/driver/origin contracts: 24 passed, four PostgreSQL cases skipped
  locally. Covers anonymous headers, pinned lookup, redirect/login errors, oversized
  and compressed responses, sanitized transport failure, unknown controls,
  mid-fill revocation, expired/cross-origin approval and restore revocation.
- Canonical persisted workflow: three SQLite cases passed. Automatic task stores
  native readback without queuing submit; revocation between fill and persistence
  rolls back; forced readiness/submit queues fail; stopped/unknown applications
  make no public-read calls. PostgreSQL counterparts require the CI database lane.
- Dedicated desktop/mobile UI: two passed. Approval acknowledgement, packet-only
  preparation command, readback, absence of submit control and revocation verified.
  Screenshots inspected; page overflow checks passed. Private UI responses are
  intercepted fixtures over a synthetic demo server, not live account evidence.
- Frozen full check: 775 passed, 269 skipped across 104 files; lint, types,
  ledger and production build passed. All 70 desktop/mobile browser cases passed.
  Public scan passed 478 files before this evidence addition; dependency audit clean.
  PostgreSQL, opt-in clean-install and server-image skips are not presented as passes.
  P18-G2/P18-02 close for native low-risk preparation; P18 itself remains open.

## Support Boundary

This fulfills the approved-origin low-risk native preparation workflow, not universal
portal submission. JavaScript-required forms, file/select/custom/sensitive controls,
multi-step and logged-in variants remain unsupported pending reviewed family adapters.
No real employer, Gmail account or model provider is contacted. The result's zero
application count is a client contract, not an independently observed employer ledger.
The 20-job-board target and genuine receipt gates are not closed by this work.

## Credential And Account-Action URL Boundary

The shared public-URL check now rejects credential/signed query fields, explicit
state-changing action parameters and account/verification/callback/submission
paths. Percent encoding, nested encoding and malformed paths cannot bypass the
known-action check; decoded slash/backslash separators are inspected. Targets are
checked before browser creation, and every resource is checked before even the
trusted injected reader is invoked. Only document, stylesheet, image and font
resource types are accepted. Ordinary vacancy IDs, source tracking, locale queries
and public apply pages remain supported. Signed or account-gated variants require
separately reviewed adapters, not credential stripping or generic GET verification.

These checks reject known unsafe URL classes; they cannot prove an arbitrary
employer implements GET without side effects. Exact public-read review remains
necessary, and no independent zero-employer-record claim is added.

Broader local check before the last encoded-separator cases:826 passed /276 skipped,
105 files; lint/types/ledger/build pass. Final hosted loader/driver/core/origin suite:
58 passed /four PostgreSQL skipped, four files. Three canonical persisted workflow
cases also pass. Final types/build pass. Do not claim a full828 run; successor CI
must verify the final security change separately from the green418d502 milestone.
