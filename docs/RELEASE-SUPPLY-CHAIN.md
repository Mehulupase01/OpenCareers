# Release Supply Chain

## Build And Inventory

Use the exact Node version in `.node-version` and pnpm 12.4.2. Install with the
frozen lockfile before building. `corepack pnpm build` now also generates
`dist/release/sbom.cdx.json`; `corepack pnpm release:sbom` regenerates inventory
without rebuilding application code. No extra SBOM dependency is installed.

The driver invokes pinned pnpm's native `sbom --prod --lockfile-only` command,
requests CycloneDX 1.6/application output, enforces a successful subprocess exit,
and bounds its output and duration. Public package/lockfile inputs must remain
unchanged while generation runs. The child receives OS/tool-location variables,
not application keys, Node injection options or private profile configuration.
Corepack/tool setup can need network access if the pinned tool is not cached;
the inventory itself is based on the local lockfile, not employer/job data.

Validation covers root identity, public npm distribution URLs and tarball hashes,
unique package identities, complete/reachable graph references, runtime dependency
roots and exact versions where explicitly pinned. The native generator resolves
ranged dependencies after the frozen install. Scoped npm package groups are retained.
Only selected public CycloneDX fields are emitted; raw authors, paths, timestamps
and arbitrary generator properties are not copied. Ordering is normalized for
repeatable generation on the same toolchain.

Metadata records SHA-256 bindings for the lockfile and normalized runtime manifest.
The Windows packager refuses missing/stale/mismatched inventories before producing
an archive. The SBOM is required in the bundle manifest and covered by archive/file
checksums. The native-only pre-install verifier checks these file bytes without
installing dependencies. Windows/Ubuntu CI uploads the generated SBOM with test
evidence. These hashes detect changed inputs; they are NOT signatures or publisher
authentication, and a malicious publisher can rewrite the manifest and inventory.

## Scope And Limits

This is declared production-package inventory, including optional dependencies for
all platforms, not an assertion that every listed platform binary is installed on
Windows. Node, Chromium, OS libraries, installation-script downloads and complete
installed-file hashes are outside this inventory. The SBOM is not a replacement for
dependency vulnerability audit, license review, artifact screening or signing.
Lockfile hashes identify package tarballs, not independently verified publisher
identities. A clean audit is time-bound and not a proof that vulnerabilities do not
exist. No live submission or production-release acceptance follows from inventory.

CI retains pinned action commit SHAs, frozen dependency installation, public-source
screening and `pnpm audit --prod --audit-level high`. The bundle independently screens
every allowed public input and generated file; private config/data remains excluded.
Investigate high/critical findings before release, do not lower the threshold merely
to make CI green. Current generation is not a full external CycloneDX JSON-schema
validator; pinned native output plus bounded release-specific contracts are tested.

## Source Provenance

The existing repository's name/history/MIT license remain unchanged. Initial
clean-room/reference provenance is recorded in `docs/sources/research.md`; it names
the reviewed upstream commit and states the historical no-copy finding. This SBOM
milestone adds original integration/validation code, not vendored upstream source.
The generator is pnpm's native command; dependencies remain identified by public
package names, versions, distribution URLs and lockfile integrity data.

When importing source/assets later, record the exact upstream URL/commit, affected
files, license/notices, modifications and tests. Do not treat this historical record
or the SBOM as blanket permission to copy code/assets or as legal clearance of all
dependencies. Retain upstream notices when distributing third-party material.
