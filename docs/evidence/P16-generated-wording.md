# Approved Wording Generation

Engineering milestone,2026-10-14. Local verification and CI38623194120 at
d0c2374141b6d2e9d244d77a4b4aaac6f91f93de pass all four lanes: Windows, Ubuntu,
PostgreSQL and server-image. P16-05/G5 close; the complete P16 phase remains open.

2026-10-15 follow-up: P15 review found source quotations could launder unsupported
candidate claims into motivation. P16-05/G5 were reopened, then reclosed after
CI38710562833 at a8484e4 passed all four lanes for the full-text/retained-packet
correction in P15-hostile-input-matrix.md. Earlier CI is historical, not this proof.

## Owner Workflow

Outcomes retains the existing immutable experiment definition and assignment
workflow. A wording variant may now include an approved generationRecipe binding:
fixed recipe ID, version and SHA-256. The catalog contains role_focus and concise;
unknown hashes, arbitrary prompts and ordering recipes are refused. Legacy manual
wording/ordering definitions retain their previous meaning and are not backfilled.

The owner selects one existing, pre-READY application and approved variant, reviews
the recipe/assessment and acknowledges generation. The server persists a bounded
prepare task and immutable generation binding. It creates no application. Results
expose status, sanitized failure, recipe, packet/critique hashes and local artifact
review links. Generation acknowledgement is separate from exact-packet assignment
review; changing selections clears acknowledgement and retries retain request IDs.

## Binding And Execution

One authoritative database stores generation requests/results alongside packets
and experiments. Enrollment binds the experiment revision/hash, recipe, application
revision, canonical job, assessment, candidate revision/profile, authorization,
approved-answer inventory and minimized generation-input digest. Questions are
schema-normalized before fingerprinting so persistence round trips retain identity.
Equivalent-job enrollment, prior intent/attempt/outcome and pending-capacity checks
run under the existing owner lock. Manual assignments also count pending capacity.

The existing worker handles a strict generation-specific prepare payload before
ordinary packet reuse. It must run bounded draft/critique/optional repair with the
reviewed free route and privacy rules; there is no deterministic fallback. Recipe,
abort and current-state checks propagate through each inference stage. Model output
still cannot rewrite the fixed opening or supplied factual contribution text.
Unsupported prose/evidence is refused by the existing compiler and packet validator.

Publication rechecks the current lease/fence, controls, experiment, inputs and
authorization, then saves packet and result in one transaction through the shared
packet persistence implementation. Recipe and generation request identity distinguish
packet IDs even when rendered content equals a baseline. Ordinary recipe-free IDs
and artifact bytes remain unchanged. Baseline packets are invalidated at enrollment;
ordinary preparation/answer refresh cannot silently substitute another packet.

Successful task redelivery retains the published packet without inference. An
interrupted draft fails closed and needs a fresh reviewed request; it is not silently
regenerated. Failures retain sanitized codes and do not release consumed inference.
Invalidated prepared results may be retired by a fresh, explicit enrollment.

## Review And Final Authority

The first inspection can establish readiness but does not queue a submission while
enrollment awaits review/assignment. Assignment requires the exact generated packet,
variant, recipe and reviewed hash, with current source/authorization evidence.
Assignment queues a fresh inspection; only then can ordinary authorization-controlled
submission proceed. The same single submission engine rechecks experiment evidence
before intent/dispatch. Generation agents never receive final-action authority.

A focused review found that a later job-identity merge could leave enrollment on
the duplicate application while its surviving baseline bypassed the hold. The
hold now resolves current canonical-group membership and runs before assignment
lookup, including for a survivor with a pre-existing manual assignment. Another
member's enrollment remains a hold in every generation state. An own-application
hold is released only by an assigned generation joined to its exact experiment,
variant, packet and hash; the dispatch guard still validates full provenance and
current authority afterwards. Merge regression verification is recorded below.

SQLite snapshots include the new table with the rest of the database. Restore
quarantine fails queued/drafting generation work and cancels its tasks, preserving
completed evidence while invalidating packet authority. Recovery never revives
model calls or releases a submission hold by itself.

## Verification

Focused recipe/gateway, worker, API and persistence tests cover legacy definitions,
strict acknowledgements/identity, pending capacity, stale source/answer/policy,
stop/revocation/lease, interrupted drafting, atomic publication rollback, exact
review, fresh inspection and restore fences. The final persistence file passes30
SQLite cases, with30 PostgreSQL cases awaiting configured CI. Four cases exercise
the real identity-merge operation with queued/assigned generation and with/without
a surviving manual assignment. The final focused run passes in39.83s. Read-only
review after the correction finds no further actionable scoped issues.

One joined case uses the real generation worker, LetterDraftRunner with a synthetic
transport, rendered local PDF/DOCX, actual Chromium/MockATS inspection, exact owner
assignment, a second actual inspection, guarded submission and one correlated
MockATS receipt. Two synthetic inference requests are consumed; there is no submit
task/attempt before assignment, exactly one attempt/receipt afterwards, no retry
claim, synthetic count1 and live count0. Fixed Date tests policy time; Chromium,
I/O and lease timers remain real. This is not a genuine P08 receipt or elapsed soak.

Four targeted desktop/mobile document and generation browser checks pass46.2s;
the generation catalog cases use explicit synthetic route fixtures, separately from
the joined worker proof. Screenshots were visually inspected and overflow checks
pass. Typecheck/lint pass with the pre-existing browser-helper warning. The final
corrected frozen full check passes1,100 tests with358 local PostgreSQL/opt-in skips
in380.36s,117 passing files and two skipped. Lint, typecheck, ledger, production
build and native237-component SBOM pass. Production dependency audit reports no
known vulnerabilities; public-source scan passes538 selected files before the
final plan/document updates. Pattern scanning does not replace private-data review.

Full desktop/mobile browser verification passes80/80 in5.3 minutes. Its API startup
precedes the final helper's assigned-generation query correction; the final frozen
unit/integration suite above includes that correction. Affected document/generation
browser checks rerun against corrected source pass4/4 in53.3s. A fresh extracted
production-only Windows installation passes1/1 in121.88s, booting its compiled
synthetic runtime without the development environment. CI38623194120 also passes
the production-only Windows installation and complete browser verification.
The initial full pass1,096/354 in363.66s
precedes the merge correction and is not substituted for final acceptance.

## Windows CI Correction

Prior fact commit411fb0a CI38569038201 passes PostgreSQL, Ubuntu, server-image,
Windows unit/integration, SBOM and production-only clean installation. Windows
browser verification passes77/78: a paused dry run is still pending after5 seconds.
Trace inspection and route review show Chromium starts before the late control
check. The route now rejects stopped/restoring/preparation-paused actions before
artifact reads/browser startup, retaining late fill/save checks. Submission and
discovery pause remain stage-specific and do not prohibit preparation. Tests prove
early refusal without artifact access, permitted stage progression with sanitized
storage failure, and successful resumed browser preparation. No global timeout is
raised or assertion removed; the failed CI run is not reported as parity.
