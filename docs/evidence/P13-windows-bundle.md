# Clean Windows Runtime Bundle Foundation

2026-10-11. `pnpm bundle:windows` rebuilds and packages a versioned ZIP under a
new canonical TEMP directory. Required compiled API/worker/runtime/dashboard,
public configuration example, pinned package/lock/workspace manifests, Node pin
and hidden Windows launchers are the explicit inputs. No repo env, private
directory, browser state, dependency tree or test corpus is copied. Package
scripts are restricted to the compiled runtime. Original dependency declarations
are preserved so production-only frozen-lockfile installation remains possible.

Every final archive input is screened with the existing public-source scanner;
private paths, credential-like bytes, unexpected artifact types and filesystem
redirection fail. Runtime outputs need regular TypeScript source counterparts,
so unrelated stale compiled files are refused. Traversal/file/byte bounds apply.
The archive contains per-file sizes/SHA-256, plus a separately emitted ZIP
checksum. Identical fixture inputs produce identical archives in the same
environment. Checksums are not code signatures or publisher authentication.
Pattern screening is not proof that arbitrary personal prose is public.

Five fixture cases cover archive and file checksums, public-only contents,
restricted scripts, credential rejection, redirected/binary artifacts, missing
runtime and stale output rejection. The opt-in clean-install integration test
extracts the actual bundle to a new directory with spaces, installs only locked
production dependencies, and runs its compiled modules and API/scheduler there.
TypeScript is absent from that install. Compiled document generation produces
CV/letter PDF/DOCX with valid semantic/format checks, while the same synthetic
fixture's unreviewed question produces needs_input. The compiled dashboard is
served by the API without Vite. Authenticated runtime stop drains the process.

This exposed a real deployment defect: document rendering imported yazl from a
development-only declaration. yazl 3.3.1 is now a production dependency, retaining
the same pinned version and lock resolution. The fixture's unknown question also
correctly refused a valid status; the test now distinguishes complete and
unresolved synthetic packet inputs instead of changing document guards.

Local opt-in clean installation and document/bundle cases passed 38 tests with
33 PostgreSQL skipped before the final stale-output assertion. Windows CI now
executes the opt-in clean test after build, and uploads its immutable ZIP,
checksum and metadata-only proof under test-results/windows-runtime. Successor
CI must verify this batch; CI 38139534828 covers the preceding host/stop batch.

The existing smoke ZIP contained 141 files / 961,508 bytes with SHA-256
bb6f1824a65992481130de953c01f0291656dc5deb6b0ed7237985bfe77af79b.
It is a development artifact, not a signed or accepted final release. Node,
Chromium and dependencies are not bundled; dependency/browser installation can
require network access. The test uses public synthetic documents, no OpenRouter
calls, no private configuration and no employer writes. It is not a full mock
submission workflow, installed logon-task/reboot drill, private deployment,
server/hybrid package, migration/rollback proof or real-duration soak. P13-01
and P17 release acceptance remain open.

Production installation uses [pnpm's documented production/frozen-lockfile options](https://github.com/pnpm/pnpm.io/blob/main/docs/cli/install.md).

After a host BSOD interrupted the last local check, verification was rerun
sequentially: pnpm check passes 631 tests / 217 skipped in 80 files
(216 PostgreSQL plus the opt-in install case), lint/types/ledger/build. The
final opt-in installation also passes, including manager exit zero and both
owned API/worker PIDs gone after authenticated stop. Public-source scan passes
380 files; production dependency audit reports no known vulnerabilities. This
does not diagnose the BSOD or establish the OS crash/startup acceptance gate.
