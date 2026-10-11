# Server Image And Private Topology

This is deployment engineering, not an accepted production release. The
topology intentionally disables external submissions. Windows local operation
remains first. Hybrid browser workers, reviewed remote challenge transport,
live receipts, migration and qualifying soaks are not supplied by this topology.

## Build

From a checked-out repository with the pinned Node/pnpm toolchain and installed
development dependencies, build the compiled distribution, then prepare a
screened context. Never use the repository directory as a Docker build context.

```powershell
corepack pnpm build
$context = corepack pnpm exec tsx scripts/prepare-server-context.ts | ConvertFrom-Json
docker build --tag opencareers-server:local $context.directory
```

The builder accepts no arguments or env configuration. It reuses the existing
screened distribution producer, copies only locked dependency inputs and
compiled public artifacts, and adds the reviewed Dockerfile. The generated
context manifest records file sizes and SHA-256 hashes. It excludes .env,
private roots, source trees, dependency directories and Windows host scripts.
Review the retained context and its bundle evidence before removing them.

The Linux amd64 base is pinned to the registry-resolved Node 24.21.0 digest.
Corepack 0.34.6, pnpm 12.4.2 and locked Playwright 1.63.0 are used. Multi-stage
installation keeps compiler tooling and development dependencies outside the
runtime stage. The runtime runs as uid/gid 1000 with a separately installed
matching Chromium. OS package repositories remain build-time dependencies;
byte-for-byte reproducible images, OS vulnerability acceptance and publisher
signing are not established. Retain the final image digest and audit inventory.

## Configuration

Keep three absolute, restricted-permission files outside the repository and
image context. Never commit or paste their contents.

- Compose selection file: OPENCAREERS_SERVER_IMAGE, OPENCAREERS_POSTGRES_ENV,
  OPENCAREERS_SERVER_ENV. The latter two are absolute paths to the other files.
- PostgreSQL file: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB only.
- Server file: AUTOPILOT_OWNER_ID, a strong AUTOPILOT_OWNER_TOKEN,
  AUTOPILOT_VAULT_KEY, AUTOPILOT_DATABASE_URL and explicit HTTPS
  AUTOPILOT_ALLOWED_ORIGINS. The DB hostname is database, private port 5432.
  Preserve and securely back up the vault key separately from database backups.

Reviewed OpenRouter free-model/provider allowlists and privacy revision can be
configured in the server file when inference is desired. Production letters
remain mandatory LLM drafts under existing factual validation; the synthetic
self-test is not an alternative production letter generator. S3 configuration
must use the existing keyed HTTPS artifact-store contract. Credentials go only
to the services that need them, never into Dockerfile arguments/layers.

Explicit --env-file avoids Compose implicitly loading a repository .env:

```powershell
docker compose --env-file <absolute-compose-selection-file> -f deploy/server/compose.json config --quiet
docker compose --env-file <absolute-compose-selection-file> -f deploy/server/compose.json up --detach --wait
```

Do not run full `compose config` into shared logs: it resolves private env values.
This deployment uses separate API and scheduler processes, not the Windows
launcher that correctly refuses server installation. Both use one PostgreSQL
authority and the same artifact volume. Worker replicas do not create a second
authority, but do not add replicas until their resource profile is measured.

## Network And Operations

Only the API is bound to host loopback 127.0.0.1:4317. PostgreSQL has no published
port and only an internal network. The scheduler has no published ports; no raw
Playwright/debug transport is provided. API/worker have an egress network because
approved discovery/inference need outbound access; this is not an egress allowlist.

A separately managed HTTPS reverse proxy must expose the API on the exact
allowed origin, preserve Origin/Host, enforce TLS and restrict health paths to
operators. Never expose 4317 directly, enable broad proxy trust, or publish
database/browser ports. Certificate issuance, real TLS tests and proxy lifecycle
are not yet integrated or accepted by this blueprint.

API readiness checks DB access; runtime health checks a fresh scheduler
heartbeat. Both services have bounded memory/CPU/process/shared-memory/temp/log
settings, init process reaping, non-root users, read-only root filesystems,
dropped capabilities and no-new-privileges. These are safety bounds, not measured
production capacity recommendations. Browser sandbox/host-kernel compatibility
and remote handoff still require deployment verification before live portals.

```powershell
docker run --rm --init --network none opencareers-server:local node dist/scripts/release-smoke.js
```

That command runs owned loopback mock fixtures with synthetic SQLite state,
not a PostgreSQL-backed application workflow, real model calls or live employers.
The opt-in CI image drill additionally starts the private server/PostgreSQL
topology, checks scheduler readiness and authenticated API access, and verifies
database port isolation. It creates only a uniquely named disposable project.

To stop without deleting data, use the same explicit selection file/project
and `compose stop`. Never use `down --volumes` on a private deployment: that
would delete its database/artifacts. Upgrade only after draining commits and
reconciling unknown outcomes. Preserve one authoritative data store. Physical
backup/restore, older-snapshot quarantine, vault rotation and schema rollback
procedures still require the P15 release drills; copying a volume is not proof.
