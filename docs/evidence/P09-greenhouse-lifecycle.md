# P09 Greenhouse Synthetic Lifecycle

Verified locally on 2026-09-28 at
`9cd7cdafc3821b3cdc88d6a76fcc3b8122fd99bf`.

Greenhouse hosted forms are now the second portal family to pass the common
adapter lifecycle. A target includes the exact board, posting ID and inspected
form fingerprint. Preparation remains read-only and can become ready only when
that fingerprint is explicitly pinned. Commit launches a fresh browser,
reinspects and fills the form, verifies every read-back and CV selection, mints
the short-lived dispatch permit, and allows one POST to the exact target. There
is no generic browser fallback.

The owned fixture proves a correlated receipt through the adapter registry.
Typed evidence binds the external receipt UUID, board, posting, internal job,
receipt URL, timestamp and candidate email hash. `SubmissionRepository`
rechecks those bindings transactionally before it creates a receipt or marks
the application confirmed. A different posting is rejected.

Negative coverage includes adapter-target drift, injected mandatory controls,
challenge and unsupported controls, validation rejection, ambiguous 503
response, expired or reused dispatch authority through the shared submission
contract, and shared prior-attempt duplicate suppression. Unknown outcomes are
not replayed. Public DEPT and Adyen forms remain read-only observations and are
not labeled live-verified; no employer write or real submission occurred.

Local verification passed 155 tests with 58 PostgreSQL-dependent cases skipped,
plus lint, typecheck, production build, a 185-file public-source scan and a
production dependency audit with no known vulnerabilities. Cross-platform CI
run `36454946703` passed Windows, Ubuntu and PostgreSQL jobs, including the
browser suites.

This satisfies P09-G1, P09-G2 and P09-G6 together with the existing Recruitee
and pre-dispatch drift evidence. P09 engineering is complete. Private live
verification remains separately pending under P08-G6 and is not required to
claim synthetic P09 completion.
