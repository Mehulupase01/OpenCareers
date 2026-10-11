# Stop-Control Acceptance

2026-10-11. Two actual owned-mock workflows test the guarded boundary, using
fresh synthetic SQLite storage, production browser code and submission authority.

- Stop just before dispatch authorization fences/cancels the leased submit task.
  Authorization returns LEASE_STALE, no dispatch timestamp is stored, no server
  application is created, no confirmation is counted and a replacement worker
  cannot claim another submit task while stopped. This is an expired-authority
  rejection, not a fabricated successful submission or an access-control bypass.
- A mock server accepts the request and loses the response. Before read-only
  receipt reconciliation, stop leaves one uncertain application and zero
  confirmations. The correlated receipt then confirms the already-accepted
  outcome while stop remains set. Exactly one attempt and one server application
  exist; stop does not erase or replay the sent request.

The dashboard displays the already-sent recall limitation while stopped.
Desktop/mobile tests prove reload persistence, separate stage-pause settings,
resume without changing those pauses and responsive layout. Screenshots were
inspected. An initial browser fixture queried the protected API before the demo
session had completed; it now waits for the authenticated stop button. No
authentication or production authority guard was relaxed.

Both integration tests and all four focused desktop/mobile operations cases
pass, with final lint/types/build checks. The broader capacity checkpoint passed
622 tests and all 60 pre-addition browser cases. Cross-platform successor CI
must verify the final additions before P13-G5 closes. This is not a hardware
reboot, sleep/wake or network-interface drill, nor a genuine employer submission.
