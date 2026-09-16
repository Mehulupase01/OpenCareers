# Source Review and Initial Audit

Checked 2026-09-16. Workspace contained no Job-Autopilot project and no applicable
AGENTS.md. OpenCareers contained a README and license, with a clean worktree; no
runtime could be reused. The owner subsequently selected OpenCareers, confirmed as
the active VS Code workspace. Its Git history, name and license are preserved.
The new implementation is clean-room. Initial bootstrap files were transferred;
superseded local install files are retained in ignored `.cache/initial-scaffold`.

Reference Career Ops: commit `aac998c7ed7248ea853b720ceeb1fdbeb322fc5d`.
Remote HEAD resolved to that commit. Its pinned license is MIT, copyright 2026
Santiago Fernandez de Valderrama. No upstream code has been copied. If code is
imported later, record each source file, changes, tests and preserved notices.
Concepts adopted: connector registry and immutable application packet snapshots.

- https://github.com/career-ops-hq/career-ops/tree/aac998c7ed7248ea853b720ceeb1fdbeb322fc5d
- https://raw.githubusercontent.com/career-ops-hq/career-ops/aac998c7ed7248ea853b720ceeb1fdbeb322fc5d/LICENSE
- https://nodejs.org/en/about/previous-releases (Node 24 LTS; pin 24.21.0)
- https://fastify.dev/docs/latest/Reference/LTS/ (supported Node LTS compatibility)
- https://www.sqlite.org/wal.html (WAL-reset fix 3.51.3+, backports 3.44.6/3.50.7)
- https://sqlite.org/changes.html (current engine history)

Initial host: Windows, Node 24.14.0, npm 11.9.0, Git 2.46.2. Docker installed,
engine initially unavailable. pnpm absent globally; use the exact npx invocation.
All dependency versions queried from npm before pinning. Full diagnostics and lock
hash will be recorded after installation. Live integrations remain unverified.

better-sqlite3 13.0.3 required unavailable C++ build tools on this host. Selected
12.11.1, which supports Node 24 and distributes Windows prebuilt binaries, subject
to runtime SQLite version verification. Native Node 24.14 SQLite is 3.51.2 and
therefore not selected for the durable WAL store.
