# Baseline Recovery, 2026-10-09

Started at dda7862. Latest prior GitHub run 37844405932 passed Ubuntu, failed
Windows on an artifact root's Windows path alias, and failed PostgreSQL because
browser-using integration tests had no installed Chromium.

## Delivered

- Canonicalize the trusted data directory before binding the artifact root.
  Reject redirected artifact/hash directories and non-regular artifact objects.
  Regression coverage exercises root aliases, directory redirects and corruption.
- Install Chromium and dependencies in the PostgreSQL CI lane.
- Browser tests run on separate configurable loopback ports 14317/14318; existing
  private services are neither stopped nor reused. Demo and readiness guards stay.
- Patch Fastify to 5.12.5 and override fast-uri to patched 3.1.8/4.1.5 branches.
  pnpm 12 overrides live in pnpm-workspace.yaml, not the ignored package.json field.
- Untrack the private masterplan PDF, retain it locally, and ignore future commits.
  The public-source scanner now refuses unreviewed PDF/DOCX documents rather than
  bypassing their content. Historical publication is not purged by this change.
- Record the owner-approved completion sequence and correct stale current-state docs.

## Verification

- Focused storage, public inventory and exception tests: 18 passed, 8 PostgreSQL
  cases skipped before the full suite; no dedicated local test database configured.
- Production dependency audit at moderate threshold: no known vulnerabilities.
- Full check, browser run, public scan and new CI: verification pending below.

## Remaining

This milestone does not close P08's live-receipt gate, P10's newly identified
workflow defects, or P11-P18. Local artifact encryption, restore blocking, session
continuation and production activation are subsequent work. No employer-facing
application was sent and no private database was migrated or reset.
