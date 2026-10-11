# Frozen Experiment Variant Attribution

The fixed-cohort contract gains an optional historical experiment evidence block
and experimentVariant grouping. Legacy snapshots parse without rewriting stored
bytes and report unassigned membership. New capture reads bounded owner-scoped
assignments and immutable definitions from the same authoritative transaction.

For a mature qualified receipt, attribution requires definition/assignment
integrity, exact reviewed packet and canonical job, a hashed intent carrying the
assignment digest, a recorded dispatch and chronological assignment <= intent <=
dispatch <= observed receipt. Missing or invalid attributed evidence fails the
whole capture; it does not silently become an unassigned comparison. Synthetic,
unverified and unresolved members remain excluded under existing rules.

Snapshots retain only categorical variant/metric/horizon fields and evidence
hashes, not private letter content. Their full digest protects replay after
later stops or source changes. Comparisons require distinct disjoint variants
of the same frozen definition and its declared horizon. Each group still needs
20 members for fractions; mixed definitions, missing attribution, mismatched
metrics/horizons or overlapping jobs fail. These are descriptive current-state
horizon fractions, not causal estimates or cumulative conversion.

Focused local verification passes 22 tests / 19 prerequisite skips in three
files. Cases include actual repository capture after stop, immutable replay,
post-intent assignment refusal, intent hash failure, missing assignment evidence,
legacy fallback, mixed-definition/metric/horizon refusal and sample thresholds.
Full local check passes 695 tests / 246 prerequisite skips in 92 files, plus lint,
types, ledger and build. Full browser suite passes 66/66 in 4.1 minutes. Extracted
production-only Windows install passes 1/1 in 22.96 seconds total. Public scan
passes 428 files. Successor CI remains pending for this milestone. Prior guarded
assignment commit b76f513524fb092e8500f4415b13ce351612b21c is all-green in run
38177319128 on Windows, Ubuntu and PostgreSQL, including full browser/install.
The typed receipt fixtures are synthetic; no employer action occurred.

See P16-calibration.md for the actual fixture denominators/windows and unanswered
live questions. P16 remains open; these changes do not add variant generation,
historical authoritative seniority/sponsorship or private correction proposals.
