# Reviewed Categorical Regression Import

Verified locally on 2026-10-11. P16-04 foundation, not a complete automatic
learning pipeline or closure of P16-G6.

## Behavior

`packages/security/src/regression-fixture.ts` accepts only three reviewed,
categorical correction types: changed employment workload, an invented-quantity
letter claim, and combined receipt/interview mail. Unknown fields, private text,
names, employers, contact details, URLs, nested facts, unknown variants and
unreviewed inputs fail strict validation. This is allowlisted transformation,
not a best-effort string redactor or LLM anonymizer.

The fact-correction helper processes validated local before/after facts. It
requires the same fact identity, an increasing revision and a verified reviewed
result. Only changed workload categories cross into the regression proposal;
fact IDs, dates, employers, titles and provenance text do not. Unsupported changes
return no proposal and are not claimed as covered.

Run the developer/maintainer importer from the repository:

```powershell
corepack pnpm regression:import C:\private\reviewed-correction.json --publish-reviewed
```

A supported input is categorical and contains no source facts:

```json
{
  "kind": "workload_correction",
  "reviewed": true,
  "before": "full_time",
  "after": "part_time"
}
```

The importer requires explicit reviewed publication, reads at most 16 KiB from
a regular input file, and writes canonical JSON only under the repository's
unredirected `tests/fixtures/regressions` directory. Generated names are hashes
of public categorical bytes, never private input, owner IDs or source filenames.
Exclusive creation prevents overwrites; identical bounded existing bytes are
idempotent, while changed bytes or redirected output fail. Success prints only
kind/filename/digest; errors are generic and do not echo source content or paths.
It does not stage, commit or push files. A partial write failure can leave a
refused fixture that needs maintainer repair, never an automatic overwrite.

This is a repository maintenance command using its development toolchain, not
an installed production-bundle command. It is not invoked automatically by fact
editing, outcome correction, inference, or final submission.

## Executable Cases

The integration consumer loads all reviewed JSON fixtures and rejects malformed
envelopes. Workload cases run the real chronology calculation on fixed synthetic
employment dates/employer. Letter cases run the existing truthful-claim compiler
and expect unsupported-claim refusal. Mail cases run the conservative classifier
and expect ambiguity. No model call, network request or external action occurs.
A seed public workload fixture ensures this path runs on every normal test suite.

## Verification And Remaining Scope

Final frozen-code `pnpm check`: **677 passed / 232 skipped in 90 files**, with
lint, types, ledger and build passing. Five focused cases cover private-shaped
payload refusal, verified local correction extraction without copying evidence,
real-domain fixture execution, idempotency, changed bytes, input size, sanitized
CLI output/refusals and Windows junction/Linux symlink output refusal.

No extra production-only installation run was needed for this maintainer-only
increment; the prior score-calibration commit's full CI includes that installation.
Successor CI is pending. No private owner data or service was inspected or changed.
No new dependency, application database or submission authority was introduced.

Subsequent CI 38168943996 at fb2a4c7a0f41382b6b713e3315f2a1183a352ac1
passes Windows, Ubuntu and PostgreSQL, including the full browser suite and
production-only Windows installation. This verifies the bounded maintainer
workflow, not automatic correction capture or the successor diagnostics workspace.

Remaining: audited automatic private proposal capture and review/export workflow,
broader corrected-fact coverage, misclassified form and adapter-drift cases,
tracking accepted/rejected proposals and ensuring every supported correction
becomes a durable regression. P16-04 and G6 remain in progress. Existing P15 and
production acceptance requirements remain open; totals stay 12/19 and 91/128.
