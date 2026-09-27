# P09 High-Yield Portal Coverage

Planned 2026-09-27 from the P09 masterplan gates and the P08 mock/Recruitee
implementation. P08 live verification remains externally pending; P08-G7 permits
unrelated adapter engineering to continue without relabeling P08 complete.

## Decision Boundaries

- Define one adapter SDK for target parsing, read-only inspection/preparation,
  commit, definitive rejection, receipt evidence and read-only reconciliation.
  The worker selects an adapter from an exact registry and contains no
  portal-specific workflow branch.
- Keep dispatch authority in `SubmissionRepository`. Adapters receive a callback
  that can mint one short-lived, single-use permit only after the durable intent
  and in-flight attempt exist. An adapter cannot alter application state directly.
- Bind every preparation and intent to adapter ID/version, exact HTTPS origin,
  tenant/board, external requisition, structural fingerprint, packet and answers.
  A target or version mismatch stops before dispatch.
- Capture sanitized structures from public forms or documented APIs. Fixtures may
  contain labels, kinds and synthetic options, but never candidate data, cookies,
  tokens, private receipts or employer API credentials.
- Support only enumerated variants. Unknown mandatory fields, challenge widgets,
  redirects, login requirements, unsupported uploads and structural drift pause the
  affected application. There is no unrestricted generic clicking fallback.
- Classify outcomes from evidence: correlated external record/receipt is confirmed;
  a returned validation response with no acceptance evidence is definitive failure;
  network loss, malformed success or uncertain duplicate remains unknown. Never
  replay an unknown final action.
- Rank portal work by eligible-job coverage measured from the owner database, then
  implementation feasibility and receipt strength. The expected initial sequence is
  Recruitee SDK migration, one Greenhouse or Lever hosted-form family, then the other.
  Current live vacancy inspection can change this order.
- Keep `live-verified` private and date-scoped. Fixture success and public GET
  inspection are not live submission evidence.

## Implementation Order

1. Add typed adapter target, preparation, commit outcome and receipt contracts plus
   a registry keyed by exact adapter ID/version.
2. Wrap owned mock ATS and Recruitee behind the SDK. Remove portal branches from the
   worker and run a shared conformance suite against both.
3. Add Recruitee discovery URL recognition and public offer ingestion so a matched
   vacancy, generated packet and commit target share one external identity.
4. Build coverage reporting by portal family, variant, account/challenge need,
   eligibility and support status. Use it to choose the second family.
   Implemented: owner-scoped full-corpus API and Discovery coverage view. Portal
   account/challenge characteristics remain unknown until each variant is
   inspected. The current synthetic workspace cannot establish a real-world
   priority; use an owner profile and current live sources before choosing.
   Greenhouse hosted external forms are the provisional second family based on
   [read-only variant research](../sources/P09-greenhouse-hosted-form.md).
5. Capture sanitized second-family variants and implement inspect/fill/commit and
   receipt correlation through the SDK. Include validation, drift, response-loss,
   duplicate and challenge fixtures.
6. Add per-variant fingerprint baselines and drift events. Pause only affected jobs
   and surface exact unsupported controls in the operations UI.
7. Publish the generated support matrix and evidence. Run SQLite/PostgreSQL,
   Windows/Linux, desktop/mobile, privacy scan and dependency audit gates.

## Acceptance

- P09-G1: every adapter passes the same lifecycle, origin, permit, receipt and
  unknown-outcome contract suite plus its portal fixtures.
- P09-G2: every supported variant produces a correlated synthetic receipt and passes
  validation rejection, response loss and duplicate suppression tests.
- P09-G3/G4: injected mandatory fields or drift stop before permit acquisition and
  cannot fall through to generic browser behavior.
- P09-G5: the support matrix separates planned, fixture-tested, public-read,
  dry-run-tested and privately live-verified status with dates and limitations.
- P09-G6: at least two portal families complete the synthetic pipeline through the
  common SDK with no portal workflow code in the worker.

## External Gates

Live verification needs a private reviewed candidate profile, active standing
policy, appropriate current vacancy and private receipt. CAPTCHA or MFA is handled
only by the scoped P10 handoff flow; P09 does not bypass or evade it.
