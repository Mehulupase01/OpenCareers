# Installed Mock Capacity And Owned-Process Measurement

2026-10-12. The compiled distribution now ships the existing capacity driver,
an optional monitored wrapper and bounded Windows/Linux process censuses. It
does not require Git, TypeScript, an env file or owner configuration when run
from the verified extracted bundle. Source-mode measurement retains its Git
source fingerprint; installed mode repeatedly verifies the manifest and its
artifact bytes, recording unavailable_installed_artifact rather than inventing
a Git commit for an archive.

```powershell
node dist/scripts/monitored-capacity.js --duration 60 --cycles 1
```

Only bounded mock workload options are accepted; no private path, profile,
target URL or credentials can be selected. The application database and files
are fresh synthetic TEMP storage under the existing marker/owner/corpus guards.
Standing mock authorization and the normal submission engine remain unchanged.
No real model/mail/employer operation is performed.

Windows census uses local CIM; Linux uses proc records and the actual page size.
Only PID, parent, birth identity and resident/working-set bytes are retained
internally. Public traces contain aggregates, not process names, command lines,
environment values or foreign process identifiers. A tracker follows only its
root and observed descendants, retains observed orphans, fences PID reuse and
bounds both census and live registry size. Missing/reused roots, unavailable
root memory and collection failures fail measurement rather than reporting zero.

The monitored wrapper samples every five seconds and after an owned mock page
opens and immediately before its browser closes. Those awaited lifecycle
snapshots capture short-lived Chromium branches and register birth identities
before potential orphaning. The hook is mock-only; real policy/handoff browsers
are unaffected. Observer failure still closes the browser in finally. Root and
observed descendants' RSS/working sets are summed conservatively, including
measurement helper overhead; shared pages may be counted repeatedly. System,
GPU and never-observed detached processes are outside this metric's scope.

The existing queue/retry/disk/Node limits remain. Observed process peaks are
bounded to 2 GiB and 128 processes. Resource report records/bytes, sampling gaps
and wall-versus-monotonic clock drift are bounded. A final census must return to
the initial observed process count after a bounded drain; traces have an explicit
finish status. Interrupted collection, mutated artifacts, clock gaps, exceeded
limits or lingering observed children are not successful evidence.

Verification: process unit/native child tests 3/3; monitored/capacity/bundle
focused suite 15/15. Full batch check before the final trace/drain refinement:
742 passed / 261 skipped in 100 files, lint/types/ledger/build. Final refinement
focused monitored tests 3/3 and production rebuild pass. Latest extracted
production-only Windows installation passes 1/1 (185.22 seconds), including real
fresh Chromium download, installed-manifest/no-Git measurement, ignored private
settings, packets, receipts, crash recovery and independent runtime boot/stop.
Public-source scan passes 462 selected working-tree files before this evidence
entry. Successor CI pending; no Linux native-census execution is claimed locally.

Durations 86400/259200 request actual elapsed 24/72-hour runs, never compressed
clocks. No qualifying soak is running or complete at this milestone. The returned
productionSoakGateSatisfied remains false, even for long runs: review complete
traces, stable-build/dependency/browser scope and required fault evidence before
closing a gate. Manifest verification does not certify dependencies, browser or
publisher authenticity. This is not a complete 72-hour outage/quota/fairness fault
matrix, real live ramp or physical Windows reboot/suspend test. Counts remain
12/19 phases and 95/128 gates.

## Windows Verification Follow-Up

CI 38276279477 passes Linux process-census coverage, PostgreSQL and server-image;
Windows failed two 10-second CIM helper deadlines and the 15-second six-browser
override rejection test. The observed evidence establishes timeouts, not a
proven underlying hosted-runner cause. Windows census now uses the qualified
CIM command, requests only PID/parent/birth/working-set properties and allows
20 seconds per helper; the 30-second sampling continuity bound is unchanged.
The native two-census test is bounded at 60 seconds. Fresh-install test overhead
is bounded at 360 seconds with individual subprocess deadlines unchanged.

Packet-backed overrides now fail at each adapter's entry before browser/HTTP
work, retaining the planning-time checks. Eighteen rejection cases across mock,
Recruitee and Greenhouse assert zero browser launches and zero injected HTTP
requests. Focused process/monitored/SDK tests pass 9/9; expanded SDK 3/3 and types
pass. Full local check passes 742 / 261 skips in 100 files, including build,
lint/types/ledger. A fresh production-only Windows install passes 1/1 in 131.21
seconds. Public-source scan passes 463 selected files before these evidence
updates. Successor Windows CI remains pending; no soak or additional gate closes.
