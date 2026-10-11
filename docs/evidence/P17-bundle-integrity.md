# Extracted Windows Bundle Integrity

The compiled `node dist/scripts/verify-bundle.js` uses only Node built-ins and
works before dependency installation. It derives the installation root from its
compiled location, accepts no target/path or environment configuration, and never
loads an env file. Optional `--manifest-sha256 HEX` checks an independently
obtained expected manifest digest; malformed options/digests fail generically.

The producer and verifier share the explicit required runtime input list. The
manifest must include that list and generated INSTALL.md. Schema fields are
strict, with 2000 entries, 1 MiB manifest, 32 MiB per artifact, 128 MiB total,
400-character paths and bounded depth/traversal. Private/unknown paths, traversal,
drive paths, backslashes, case collisions and duplicate entries fail before reads.
Only distribution roots and reviewed compiled/static artifact families are read.

Checks cover actual sizes/hashes, missing required files, linked/redirected paths,
bounded descriptor reads and concurrent file identity/metadata changes. Runtime
tree enumeration is streamed and bounded; unlisted dist files fail without their
contents being read. Owner .env/private data and non-bundled node_modules are not
enumerated or verified. Reports contain distribution counts, version and manifest
digest only, not local paths or file contents. CLI failures emit no parsed input.

Checksums do not authenticate a publisher. A rewritten manifest is not a trusted
signature, and an already-modified verifier cannot attest itself. Verify the ZIP
digest from an independently trusted channel first. Outputs explicitly report
publisherIdentityVerified, dependenciesVerified and productionReleaseAccepted as
false; they do not imply signing, dependency attestation or production acceptance.

## Evidence

- Final frozen full check: 727 tests passed / 258 prerequisite skips in 94 files,
  plus lint/types/ledger/build. Focused integrity/bundle tests: 22 passed / 1 skip.
- Windows directory-junction refusal is exercised. Windows file-symlink creation
  returned EPERM; that separate fixture is explicitly Linux-only and awaits CI.
  No privilege or permission workaround was used.
- Initial extracted installation failed because the production compiler's
  explicit entrypoints omitted the new CLI. Adding that entrypoint and rebuilding
  corrected it. Final production-only install passes 1/1 (24.59 seconds total).
- That extracted archive executes verification before pnpm installation, matches
  an expected manifest digest, refuses an incorrect digest, detects same-length
  worker-byte corruption, restores the fixture file, then runs document/self-test
  and independent compiled runtime checks. No TypeScript/test runner is installed.
- Public-source scan passes 441 files. Bundler tests additionally inspect every
  archive entry/hash, reject secret-like compiled bytes/binary private documents,
  and assert .env/private directories are excluded. Final archive construction
  scans its selected bytes, not the owner's installation data.
- Predecessor 9a25aaa0446746cbdb1be6f620dab71443610163 is all-green in CI
  38180922212 on Windows, Ubuntu and PostgreSQL, including full browser and
  production-only Windows installation. That run does not cover this new verifier.

P17-G6 closes at this bounded repository/distribution privacy level: public
allowlisted runtime artifacts and synthetic fixtures contain no private owner
configuration, personal CVs, sessions or receipts. Pattern scans are not a general
proof about arbitrary files and do not replace reviewing distributed inputs.
Other P17 gates and the P16 dependency remain open. Successor CI is pending; this
is not a clean physical-machine, signed release, server/hybrid, live-submission,
crash/challenge demonstration or actual-duration soak acceptance claim.
