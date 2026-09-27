# P09 Pre-Dispatch Drift Evidence

Verified 2026-09-27 at `a2f755df5f354fe09e61a9cc997f2da3b8b7a35a`.

- Recruitee re-reads the exact offer before its permit callback. A newly
  injected mandatory unsupported question returns `FORM_CHANGED`, with zero
  permit calls and zero application POSTs. The same form is unsupported at
  preparation.
- The owned mock portal re-inspects both steps. A changed required question
  after READY stops before permission, with zero application records. Desktop
  and mobile Playwright cases pass.
- A fenced attempt can become `BLOCKED_BEFORE_DISPATCH` only while its
  `dispatch_started_at` is null and its intent hash and task ID match. The
  application becomes `UNSUPPORTED`; only that task can acknowledge the
  outcome. A fresh preparation can proceed. Lease recovery after the durable
  abort also completes the task without fabricating an unknown submission.
- Once a dispatch permit has been acquired, the pre-dispatch abort is refused.
  The existing unknown-outcome/reconciliation path remains in force.

`corepack pnpm check` passed locally: 122 tests, 56 skipped without local
PostgreSQL, plus lint, typecheck and build. The mock browser suite passed 22
desktop/mobile tests. Fresh GitHub Actions run
[`36329334882`](https://github.com/Mehulupase01/OpenCareers/actions/runs/36329334882)
passed Windows, Ubuntu and PostgreSQL jobs. This closes P09-G3/G4 for the
registered mock and Recruitee adapters. Exact changed-field details are not
yet persisted or shown in the operations UI, so P09 remains in progress.
