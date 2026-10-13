# Native Windows Process Census

2026-10-13. Hosted Windows WMI remains a demonstrated failure, not repaired by
the earlier local System.Management result. CI 38328631548 at ca0c4c9 passed Ubuntu,
PostgreSQL and server-image; Windows had two failing initial census tests. Its
diagnostic showed 180.34ms launcher-subset startup and a 20024.65ms census timeout.
Thus enumeration/connection remains the failing path; its deeper hosted cause is
not established. The docs-only successor run also failed Windows.

The replacement uses documented Toolhelp process snapshots, query-only process
handles, creation FILETIME and working-set counters. It no longer requires WMI
services or RPC. Query failure/exit can exclude inaccessible processes; root
identity must still exist for owned-tree measurement to proceed. No privilege
escalation, debug access, VM memory reading, filenames or command lines is used.
The Toolhelp entry's executable-name bytes are not decoded or retained.

Only PID, parent PID, UTC birth ticks as a string and RSS cross the helper boundary.
A birth after the snapshot timestamp cannot inherit a recycled PID's old parent.
Existing tracker root/child birth and live-parent birth-order fences remain.
Every opened native handle and buffer is released. Enumeration is bounded to
20000 records; the subprocess still has a 20-second deadline and 4 MiB output
limit and receives only the OS environment subset. Failure never substitutes
Node-only memory, fabricated records or a skipped contract.

Native helper bytes are included in source-capacity fingerprints and compiled
bundle manifests. The already launched WMI-based immutable resource candidate
is unchanged and cannot certify this newer reader.

Focused owned-process/native-child/monitored-browser contracts: 8/8 passed locally.
Diagnostic: native census 459.12ms, startup 177.13/174.05ms. Full successor results
and remote Windows evidence must be recorded before claiming hosted success.

Primary interface references: [PROCESSENTRY32W](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/ns-tlhelp32-processentry32w),
[GetProcessMemoryInfo](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo),
and [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes).
The small interop reader is original project code against these documented APIs,
not copied upstream implementation or an undocumented NT information layout.
