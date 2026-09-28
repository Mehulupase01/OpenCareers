# P18 Owner-Account Sources, Universal Hosted Forms, And Portal Breadth

Planned 2026-09-28 after the Stage 0 masterplan conformance audit at `497ca21`.
This phase carries the portal breadth that the masterplan's P09 anticipated and
that the owner added by conversation on 2026-09-28. P09 is closed and its
adapter contract is proven, so this phase extends coverage without redefining
what submitted means.

Owner instructions of 2026-09-28 take precedence over the masterplan where they
conflict, per `docs/amendments.md` item 1. The masterplan's own Ch.02 exclusion of
restricted logged-in scraping is therefore not binding here; the constraints
below are the ones the owner actually set, plus the safety invariants that make
the result verifiable.

## Decision Boundaries

- Every third-party account this phase holds a session for must be the owner's
  own account. The owner has confirmed this. The repository stores only encrypted
  session state; no account credential, cookie value, or storage-state blob ever
  enters a model prompt, a log, an audit payload, an API response, or Git.
- Logged-in ingestion is read-only over the owner's own search results and job
  detail pages, at a bounded request rate with a persisted cooldown, and it
  retains the same dated raw evidence as a public connector. It is a discovery
  source, not a bypass of any site's controls.
- A challenge encountered during logged-in ingestion or a hosted form is routed
  to the P10 visible handoff. The owner solves it in the owned visible browser
  and automation continues. No CAPTCHA solving, challenge-token reuse, fingerprint
  deception, proxy rotation, or anti-bot evasion is built in this or any phase.
- The universal hosted-form engine inspects an arbitrary approved origin, maps
  labelled controls to semantic keys, and fills only recognized low-risk fields.
  Ambiguity is a stop, not a guess: an unlabelled control, a duplicated label, or
  a value that cannot be read back exactly makes the preparation `unsupported`.
  A mis-mapped control is a false statement to an employer, which is the failure
  mode that matters more than coverage.
- The engine may never auto-submit. Commit authority stays with the P08
  submission package behind its own policy gate, intent, permit, and receipt. The
  engine produces a `ready` preparation or nothing.
- An approved-origin list is explicit and per source. A lookalike host must not
  be able to obtain candidate data, and a redirect is revalidated against the
  same list.
- Each family is its own increment with its own synthetic lifecycle: one
  successful receipt, at least one negative case, and a variant fixture. A family
  with a fixture-only path is labeled `fixture_tested`, never `live_verified`,
  and a family with no synthetic lifecycle is not registered in the support
  matrix as anything but `planned`.
- Employer-facing API credentials are never used. A public listing endpoint is
  not treated as a public application endpoint.
- Live-verified remains reserved for a genuine private receipt with a date, for
  every family including this one.

## Implementation Order

1. **Owner-account session vault.** Reuse the AES-256-GCM envelope in
   `packages/security/src/vault.ts` with a new `browser_storage` purpose already
   declared in that file, add `owner_sessions` in migration v11 bound to owner,
   source origin, and adapter, and add `packages/persistence/src/session-repository.ts`
   that returns session metadata and a decrypted blob only for the exact owner
   and origin, zeroing the buffer after use. Prove that the blob never appears in
   a pino log line, an audit payload, or an API response with
   `tests/unit/vault.test.ts` and `tests/integration/sessions.test.ts`.

2. **Universal hosted-form inspection and fill.** Generalise the primitives in
   `packages/browser/src/adapter.ts` into a family-agnostic inspector: visible
   label to control association including `aria-label`, `aria-labelledby` and
   wrapping labels; control classification; required-flag inference; structural
   fingerprint over origin, path, step, controls, and hidden required controls;
   and the existing `blocker` taxonomy of `none`, `challenge`, `login`,
   `unsupported`. Add `packages/browser/src/hosted-form.ts` that plans and fills
   only controls it can map to a semantic key and read back byte-exactly, and
   that returns `unsupported` for anything ambiguous. Reuse the existing
   read-only write barrier. Prove with `tests/unit/hosted-form.test.ts` covering
   duplicate labels, an unlabelled control, a hidden required control, a
   value-overwriting resume parser, and exact read-back, and with
   `tests/e2e/hosted-form.spec.ts` against the owned mock ATS.

3. **Owner-account job ingestion.** Add a discovery connector family in
   `packages/discovery/src/connectors.ts` that reads a persisted
   `owner_session` rather than an anonymous public endpoint, with an
   owner-configured request interval, a minimum inter-request delay, and the
   same page-evidence capture and count-drop warning as a public connector. Add
   the family to `sourceInputSchema` in
   `packages/contracts/src/discovery.ts`, to the coverage repository, and to the
   Discovery UI. Prove the three invariants the masterplan cares about: repeated
   polling creates no duplicate jobs, a parser that suddenly returns nothing
   produces a quality warning and not a mass closure, and evidence is retained
   with a fetch timestamp.

4. **Public-API family expansion.** Add Ashby, Teamtailor, SmartRecruiters,
   Workable, Personio, and Breezy one at a time. Each needs a Zod wire schema, a
   `normalizePage` branch placed before the Lever fall-through, a URL builder, a
   `hostedUrl` and `recognizeUrl` branch, an approved host in
   `packages/discovery/src/transport.ts`, a synthetic fixture branch in
   `packages/discovery/src/fixtures.ts`, a coverage row, and unit plus
   integration tests. Take one dated read-only public sample per family and
   record the page hash in `docs/sources/`. Never a write.

5. **Account-gated family adapters.** Add Workday, SuccessFactors, iCIMS,
   Jobvite, and BambooHR one at a time through the P10 vault for signup or
   login, then the P07 SDK contract for inspect, fill, commit, and receipt. Each
   family names its own supported host patterns, form variants, account
   behaviour, challenge detection, commit action, and receipt evidence. Ranking
   is by measured yield from the coverage report, not by platform popularity, so
   the order within this step is decided by data rather than fixed here.

6. **Coverage and support matrix.** Every variant added in steps 2 through 5
   appears in `CoverageRepository.report` with discovery, inspection, fill,
   account, commit, receipt, and reconciliation levels, a last-tested date, the
   exact blocker where unsupported, and `adapterVersion: null` until an adapter
   version is actually registered. `docs/adapter-support.md` is regenerated from
   that report rather than hand-edited, so the two cannot drift.

## Acceptance Mapping

| Gate | Satisfied by |
| --- | --- |
| P18-G1 owner-account session stored encrypted, never in prompts, logs, audit, or responses | Step 1 |
| P18-G2 arbitrary approved-origin hosted form inspected and low-risk fields filled and read back, ambiguity stops as unsupported | Step 2 |
| P18-G3 logged-in ingestion rate-limited, deduplicated, dated evidence, no mass false closure | Step 3 |
| P18-G4 every added public-API family passes the connector contract with a dated read-only sample | Step 4 |
| P18-G5 every account-gated family stores credentials in the vault and completes a synthetic account plus application lifecycle | Step 5 |
| P18-G6 a drifted or unsupported family pauses only its own version and permits a fresh preparation | Steps 4 and 5, each with a drift case |
| P18-G7 no family is live-verified without a genuine private receipt and date | Step 6 |

## External Gates

The owner must confirm the specific accounts this phase may hold a session for
before step 3 runs. Until that confirmation is recorded, P18-G1 and P18-G3 stay
`not_started` rather than being attempted against an unconfirmed account. No
other gate in this phase requires an external input; every one is satisfiable
against owned fixtures and dated read-only public reads.

## Traceability Gaps Closed

- **R01** ingest direct company vacancies and supported job feeds, beyond the
  three families currently wired.
- **R06** fill and finally submit supported forms, widened by the account-gated
  families that the current three cannot reach.
- **T03** owner-account ingestion must not create a receipt or a confirmed state.
- **T31** a session that returns an empty feed must warn, not close the corpus.
- **T32** an expired session on any family routes to an account exception rather
  than an indistinguishable network fault.

## Out Of Scope

No CAPTCHA solving, anti-bot evasion, proxy rotation, or mass automated
Easy Apply submission through an aggregator funnel. Employer ATS application
flows are fully in scope; aggregator mass-apply is not. No recruiter outreach
automation, no calendar or interview booking, and no message sending. No
multi-user or multi-tenant work. No live employer write from any test, and no
public release of session material.
