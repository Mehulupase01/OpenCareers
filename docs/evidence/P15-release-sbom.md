# P15 Release Dependency Inventory, 2026-10-14

Adds a native pnpm CycloneDX 1.6 production-lockfile SBOM to ordinary builds and the
required Windows bundle inputs. Records lockfile/runtime-manifest SHA-256 bindings,
checks package identities/distribution integrity and graph closure, normalizes public
fields and refuses missing/stale inventory before packaging. The native verifier
requires and hashes the SBOM before dependency installation. CI preserves it with
the existing public test evidence. Source and copied-code provenance expectations
are in `docs/RELEASE-SUPPLY-CHAIN.md` and `docs/sources/research.md`.

No new dependency, private config access, employer/mail/model request, automatic
application or Android/server expansion is introduced. The existing server context
continues to consume the screened bundle; its fixtures include the required inventory.

Initial native generation: 237 production dependency components / 238 graph nodes.
Focused SBOM/bundle/verifier checks:32 passed /one platform skip, four files in6.41s.
Additional server-context/graph checks:11/11 passed in2.35s. Types/lint pass with
the existing browser helper warning. Current production audit reports zero known
info/low/moderate/high/critical findings. Final frozen `pnpm check` passes with
explicit native exit propagation:870 tests /285 local skips,109 passing files /two
skipped in326.36s; lint/types/ledger/build and native SBOM generation pass. Existing
lint/chunk warnings remain. Fresh Windows production-only clean installation passes
in142.02s: native pre-install file/manifest verification, isolated Chromium, compiled
API/dashboard boot, two guarded mock receipts including lost-response reconciliation,
unknown-question blocking and graceful owned-child shutdown. The archive includes
the required SBOM. Actual archive SHA-256:
`1c640e2d07e91cc5c32f2fbaeef6a6e19dab5b49fb79133b0f5f56ded891877a`.
Ignored evidence is `test-results/windows-runtime/clean-install.json` and `runtime.zip`.
Local Node is24.14.0; exact release Node24.21.0 remains separately enforced by CI.
Do not treat this checkpoint as a signed production release or installed logon/reboot
verification. The unchanged frontend already passed76/76 browser cases at160bad9;
the recovery commit's CI38539679446 now passes all four lanes including Windows.

P15-04 supply-chain engineering ticket is complete. No phase or gate closes:
12/19 phases and98/128 gates remain the totals. Broader security review, physical
recovery, complete fault matrix, actual soaks and final signed release remain open.

Inventory includes all declared optional platforms; Node/Chromium/OS and secondary
installation-script downloads are not independently inventoried. This is not full
installed-file authenticity, license clearance, an external complete-schema validator
or vulnerability absence proof. The native generator runs with an OS/tool-only
environment, bounded output/deadline and verified exit status; Corepack bootstrap
can need network if the pinned manager is not cached. No phase closure is claimed.
