# P16 Outcome Foundation

Verified locally on 2026-10-11. This is independent engineering while P15 remains
open, not closure of P16 or evidence of genuine employer outcomes.

## Implemented Workflow

- An additive migration provides owner/application foreign keys, per-application
  revisions, request identities, previous-event links and a current snapshot.
  Every repository write includes source, actor, evidence reference/digest,
  occurrence time and recording time. Corrections append; reversal restores a
  prior classification in a new attributed event without deleting history.
- Owner writes require an expected revision and UUID request identity. Concurrent
  edits have one winner; exact retries are idempotent and changed payload reuse
  fails. Evidence must fall inside the application's timeline. References are
  bounded identifiers, not free-text recruiter messages or filesystem paths.
- Existing Gmail ingestion appends the event inside its existing owner-locked
  transaction. Classification consumes stored P11 correlation, never client
  assertions. Only correlated application receipts, interview invitations and
  explicit rejections map automatically. Account, ambiguous and unrelated mail
  cannot become application outcomes. Missing replies remain UNKNOWN.
- Newer mail cannot overwrite owner corrections. Old/tied mail is ignored; a
  delayed receipt cannot regress an advanced outcome. Application state, standing
  authorization, control revision and submission authority are untouched.
- Application mail contexts now cover the preceding 180 days, rather than 14.
  Signup contexts retain 14 days. Existing limits remain: 1,000 total contexts,
  50 per resumable scan, bounded pages and provider acquisition. Contexts beyond
  180 days need explicit owner evidence; this is not unlimited mailbox history.
- Authenticated routes expose history, owner records, reversal, stored-message
  classification and read-only cohort reporting. The Outcomes workspace supports
  those owner workflows, displays provenance and distinguishes synthetic data.

## Report Methodology

The current report measures **current recorded outcome fractions**, not cumulative
conversion, ranking quality, interview likelihood or hiring probability. It never
uses silence as rejection and cannot change policy or dispatch anything.

Eligibility requires a non-synthetic job, confirmed application, same-application
confirmed attempt and receipt, an inclusive UTC first-receipt window and a
completed observation period. Synthetic, duplicate, unverified, unresolved,
outside-window and still-observing exclusions are counted. The default observation
period is 30 days; rates are refused below 20 eligible records. An emitted fraction
includes numerator and denominator; the report includes exact window, as-of time,
observation period, threshold and exclusions. The UI takes its as-of time from the
API, avoiding browser/server clock skew; date controls use midnight UTC bounds.

Only events both recorded and occurred by as-of contribute to the current label.
An owner correction recorded later cannot rewrite an earlier knowledge cutoff.
Membership still uses current job/submission records: this is not an immutable
historical cohort or a comparison between source/role/seniority/sponsorship or
document-variant groups. Reads refuse more than 10,000 applications or 100,000
events rather than silently truncating. History refuses more than 1,000 events.
Private evidence digests attest the referenced bytes, not the truth of an owner's
classification; manual records remain explicitly owner-sourced.

## Verification

Final frozen-code `pnpm check`: **665 passed / 228 skipped in 86 files**, with
lint, types, ledger and build passing. The skipped PostgreSQL cases are not local
parity evidence; the remote PostgreSQL lane must verify them. Existing unrelated
lint and bundle-size warnings remain unchanged in scope.

Outcome integration cases cover provenance, timeline validation, owner isolation,
revision races, request binding, append-only reversal, mailbox attribution,
advanced/owner precedence, insufficient-data refusal, mature denominators,
exclusions, historical knowledge cutoff and 180-day context expiry. API tests
cover authentication and refusal of spoofed source/classification fields. Gmail
integration tests exercise its real ingestion transaction and correlator using
synthetic context fixtures; the separate context test exercises the real SQL join.

Final Playwright workflow passes **2/2 desktop/mobile**, including manual records,
reversal, unchanged submission state and synthetic-cohort refusal. Screenshots
were inspected and page overflow assertions pass. Extracted production-only
Windows installation passes **1/1 (23.09 seconds)**, including compiled packet
generation, guarded mock workflow, isolated startup and runtime drain.

Tests seed only isolated synthetic evidence, including test-only non-synthetic
flags to exercise report eligibility. No resulting fixture rate is published as
an employer measurement. No private DB, Gmail consent, model call, real application
or live outcome was inspected or changed. Successor CI is pending at publication.

## Remaining Acceptance

P16 remains in progress, with no gate closure in this batch. Still required:
immutable/group-compatible cohort reporting and comparison refusal, score-band
calibration against fixed reviewed labels, sanitized correction-to-regression
import, controlled pre-dispatch experiment assignment/stop semantics and a final
calibration report with genuine-data insufficiency clearly stated. P15 dependency
and the existing release requirements remain intact. The ledger API does not yet
implement experiments or turn a correction into a generated regression fixture.
