# Controlled Experiment Foundation

## Scope

Owner-scoped immutable definitions contain two to four reviewed wording/ordering
variant identifiers, approval evidence hashes, a declared SCREENING/INTERVIEW/OFFER
metric, observation days, finite expiry and an assignment limit. Definitions do
not contain prompts, claims, policy patches, weights or submission commands.
The owner must review the actual validated packet against the chosen variant.
This foundation does not generate or transform experiment wording automatically.

Assignments bind one existing READY application, canonical job and validated,
uninvalidated packet ID/hash to one variant. No application is created. Intents,
attempts and recorded outcomes prevent retrospective assignment. Exact UUID
retries return their immutable evidence; changed reuse fails. Owner transactions
serialize assignment limits and duplicate checks across SQLite/PostgreSQL.
Identity merges are checked again before dispatch. Evidence integrity checks are
corruption guards, not protection against a privileged database attacker.

The sole guarded submission engine checks experiment state, expiry and exact
assignment/packet binding before recording intent and again before granting its
single-use permit. Its intent carries the assignment digest. Stopping after
intent blocks dispatch without inventing a receipt or silently resetting state.
Stopping after dispatch does not prevent receipt confirmation/reconciliation.
Previously recorded assignments are not erased or switched. A packet rebuild
cannot silently replace an assigned packet; an explicit future supersession
design would be required. Assignment caps block new enrollment, not already
approved assignments. Expiry and manual stop block their dispatch too.

All existing lease, form, artifact, standing-policy, profile, duplicate,
restoration and mandatory external LLM-letter checks remain authoritative.
Experiments cannot authorize a final click or adopt a policy recommendation.

## Owner Workflow

Authenticated routes provide definition create/catalog, stop with revision CAS,
ready packet catalog and immutable assignment create/catalog. Catalogs fail
on bounds instead of truncating evidence. The Outcomes workspace supports a
bounded definition JSON import, review acknowledgement, persisted selection,
exact-packet/variant review, retry-safe assignment, assignment history and stop.
Definition import errors never reflect arbitrary uploaded content.

## Verification

Focused SQLite checks pass: four experiment repository tests and four actual
guarded submission tests. The latter use existing generated synthetic packets
and production preparation/authorization/receipt contracts. They prove stop
before intent, stop before dispatch, expiry at dispatch and receipt confirmation
after stop. PostgreSQL equivalents exist and require CI/local test database.
Repository cases cover definition immutability, owner isolation, duplicate
assignment, known-outcome refusal, quota, invalid/revoked packets, identity merges,
digest tampering, no application creation and unchanged control policy.

Local full check passes: 692 passed / 244 skipped in 92 files, plus lint,
typecheck, ledger and production build. Initial full browser run passed 64/66;
the two new Outcomes cases exposed an implicit label including loaded option
text. Explicit selector labels fix that issue; affected desktop/mobile cases
then pass 2/2 with no page errors or page-width overflow. Production rebuild
passes after this accessibility-only change. Mobile full-page screenshot was
inspected. Extracted production-only Windows install passes 1/1 in 25.54 seconds
total. Public-source scan passes 426 files. Successor cross-platform CI is pending.
Browser evidence exercises definition review, creation, history access, stop
and persisted reload, not live employer results or assignment with real packets.

## Remaining Acceptance

P16 stays open. Frozen receipt-backed comparison by actual experiment variant,
automatic variant generation with truthful independent validation, relevant
policy-recommendation workflow and its recorded owner revision, automatic private
regression capture, historical metadata/version compatibility and final honest
calibration report remain. No causal improvement or real employer response rate
has been measured. No private owner runtime, mailbox, model call or employer
submission is part of this evidence.

Prior fixed-cohort commit 02db6eb2d7bf99477b8ece05064447d797756549 failed overall
CI run 38174100947 because the Windows synthetic installer exceeded its bounded
45-second subprocess timeout with no output. Its cohort tests passed. This
milestone raises that subprocess deadline to 90 seconds and its enclosing test
deadline to 240 seconds, retaining all consent/configuration checks and cleanup.
The exact hosted-runner delay is not diagnosed; successor Windows CI must pass.
