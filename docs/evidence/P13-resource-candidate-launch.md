# Frozen Installed Resource Candidate

Started 2026-10-12T16:52:22.286Z, requesting 259200 actual seconds (72 hours),
1200-second workload intervals, 60-second capacity samples and at most 216
scenario cycles. This is a provisional resource trace, not a qualifying
production soak, completed duration or complete P15 fault matrix.

The separately extracted, production-only Windows installation had passed its
compiled mock/recovery/runtime/measurement checks in 131.21 seconds. Runtime
bytes correspond to the Windows repair batch pushed as 11f7939. Archive SHA256:
a6bbce047f9a40dc21142c2a91f65dabe2e2027985a98febbab8307a54b77d81.
Installed manifest fingerprint:
06da403adafa9872f187bd109a7836d6d058c7d9a130324b80fdbc87077b5477.
Installed traces truthfully record unavailable_installed_artifact for Git identity.

Recovery locations, relative to the launching owner's TEMP:

- Installation: %TEMP%/opencareers-windows-bundle-FSZdY9/clean installation
- Browser cache: %TEMP%/opencareers-windows-bundle-FSZdY9/isolated chromium
- Synthetic database and traces: %TEMP%/opencareers-capacity-8PMnNu
- Final stdout/stderr: %TEMP%/opencareers-capacity-launch-b867439adcde4f5abd78af6ed5b55e3b
- Observed process: PID 29796, created 2026-10-12T16:52:20Z; verify birth identity,
  not PID alone, before attributing any later process.

The launcher used a hidden window, a minimal OS-only environment, an isolated
browser cache and explicit env-file suppression. No credentials, private
configuration or existing application data were passed. It runs compiled code,
not an editor/agent process. Its first standard scenario produced exactly one
guarded mock receipt. At the last recorded checkpoint, periodic collection
continued without stderr; observed peak RSS sum was 558915584 bytes and peak
process count eight. These are preliminary observations, not final maxima.

Keep this installation and its traces immutable. Later repository builds and
outcome-metadata changes do not update it. This old-build candidate cannot certify
those later changes or the final release. Clock/sampling gaps, sleep, crashes,
artifact mutation, resource limits or collection errors invalidate the run; no
missing elapsed time may be backfilled. Check both finish records and final JSON,
not just process survival, before recording completion. productionSoakGateSatisfied
remains false. It lacks the full outage/quota/fairness matrix, physical startup/
reboot evidence and live ramp; 24/72-hour acceptance gates remain open.

The benchmark can outlive the current coding turn. Continuation scheduling was
attempted but unavailable on this host; no coding heartbeat or automation was
created, and the benchmark is not a background coding agent.
