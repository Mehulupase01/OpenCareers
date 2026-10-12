# Server Image Foundation

2026-10-12. Independent P14 engineering adds a public screened context builder,
digest-pinned non-root Node image, locked production-only dependencies and a
private Compose topology with separate API and scheduler services. It reuses
the application PostgreSQL contract and shared artifact storage. No new
application database or final-submission authority is introduced.

Registry inspection confirmed Node 24.21.0 bookworm-slim Linux amd64 digest
51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd.
The existing pinned PostgreSQL index is version 17.9; its persistent mount is
therefore /var/lib/postgresql/data. No mutable image tag is used by the supplied
Dockerfile/database service. Browser dependencies come from locked Playwright.
OS apt repositories remain build-time variable inputs, not a byte-reproducibility
claim. Upstream guidance: [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
and [Playwright Docker guidance](https://playwright.dev/docs/docker).

Four focused local tests pass: exact screened context bytes/digests, private
input exclusion, credential-like Dockerfile refusal, non-regular-file refusal,
and topology/runtime compatibility assertions. The context copies reviewed
compiled distribution inputs rather than the repository or owner environment.
Runtime secrets are external env files; database credentials are separate.
Explicit Compose --env-file prevents implicit loading of repository .env.

The local Docker CLI can inspect public registry manifests but cannot connect
to the stopped Linux daemon. No daemon was started and no image or Compose
execution is claimed locally. The opt-in image test and separate pinned-action
CI lane build the image, inspect non-root/version/dependency/privacy properties,
run network-isolated mock receipts, and boot the private PostgreSQL/API/worker
stack with a uniquely named synthetic project and disposable secrets. It checks
worker freshness, authenticated access and unpublished database/browser ports.
Execution results are pending until that lane is observed.

The mock receipt test uses synthetic SQLite inside the image. The PostgreSQL
leg currently verifies boot/health/auth/isolation, not a full PostgreSQL-backed
mock application or hybrid workflow. External submissions remain forced off.
Real TLS/proxy transport, browser sandbox compatibility on the host, migrations,
backup/restore, hybrid authority, remote challenges and resource measurements
remain open. No P14 gate or phase closes from static fixtures or a skipped image
test. Frozen local full check passes 732 tests / 259 skips in 97 files, including
lint, types, ledger and production build. Public-source scan passes 454 selected
files. Running the context CLI on the actual compiled distribution produced
161 screened files and manifest digest
e04d8d26b876abcc45e45e116e284eedf6087e42118fe359499d9e67ed71846e.
This is actual context preparation, not an image build. Windows installation
and full browser behavior were unchanged; recovery successor CI is separately
pending in run 38182786548.

Follow-up: 38182786548 passed every original lane. Image runs 38183327763 and
38183718653 built the non-root image and executed network-isolated mock receipts,
but Compose health failed. Bounded synthetic logs show API startup succeeded.
Focused API reproduction proves the supplied probes' loopback/service Host is
rejected by the exact server host guard. Image/worker probes and synthetic CI
client now send the configured HTTPS Host instead; allowed hosts are not widened.
The focused API/context suite passes 23/23. Corrected container execution remains
pending until observed, so no additional deployment gate closes.
