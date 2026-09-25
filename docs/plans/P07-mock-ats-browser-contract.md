# P07 Mock ATS And Browser Filling Contract

Plan prepared 2026-09-25 from masterplan chapter 10 and phase page 36. P07
consumes immutable P06 packets. It ends at verified READY in dry-run mode; P08
adds the durable final commit protocol.

## Decisions

- Run a first-party mock ATS on a dedicated loopback origin with synthetic jobs,
  multi-step application forms, server-side application records, unique receipt
  IDs and resettable failure fixtures. The server, not browser text, is the test
  oracle for whether a submission occurred.
- Own isolated Playwright contexts with bounded concurrency, timeouts, URL and
  request allowlists, cancellation, safe trace retention and encrypted session
  state where persistence is needed. Demo contexts may reach only the mock origin.
- Define adapter contracts for detection, inspection, blocker classification,
  field planning, filling, read-back, commit readiness, observation and receipt
  evidence. The adapter returns typed observations; central code owns policy and
  state transitions. P07 implements mock detection and preparation methods;
  P08 activates the commit methods through its authority gate.
- Snapshot canonical origin, job and requisition identity, step, labels, field
  types, required flags, option labels and values, conditional rules, upload
  constraints and a stable structural fingerprint. Store only sanitized form
  diagnostics. Exact question meaning and option sets are bound to each answer.
- Fill text, email, phone, textarea, select, radio, checkbox, date, file,
  autocomplete and bounded-character answers by accessible relationships. Verify
  actual control values after filling and again after dynamic or resume-parsing
  events. An unsupported required control is a precise exception.
- Observe upload progression from selected through uploading to accepted or
  failed. A local file selection alone is never accepted evidence.
- In dry-run mode, block finalizing navigation and requests at the browser
  boundary, including Enter, change events and implicit form submission. Assert
  zero mock server application records after every preparation fixture.
- Model challenge, login, missing-answer and unsupported-form states as scoped,
  resumable exceptions. A challenge on one job does not pause another job.
- Treat a generic banner, an HTTP 200 or an account-created response as
  insufficient receipt evidence. Receipt observation requires a job-specific
  server record and correlation context; P08 will own final classification.

## Implementation Order

1. Add mock ATS fixtures and server with hard-coded loopback binding, synthetic
   identity, controlled steps, uploads, conditional questions, failure toggles,
   account versus application records and explicit receipt endpoints.
2. Add typed adapter SDK and sanitized form-snapshot/fingerprint structures.
   Bind P06 manifest artifacts and answer proposals to exact question semantics.
3. Add the bounded owned-browser runtime, origin enforcement, session lifecycle,
   cancellation and safe diagnostic capture.
4. Implement form inspection, field plans and fill/read-back primitives for all
   required control types. Reinspect on conditional reveals and resume overwrite.
5. Implement upload state observation, changed-question invalidation, challenge
   exceptions and preparation-to-READY persistence without commit authority.
6. Test difficult fixtures: overwritten name, hidden sponsorship, conditional
   required field, delayed upload rejection, autocomplete choice, duplicate
   labels, changed salary unit, disabled submit and misleading success banner.
7. Run unit, SQLite/PostgreSQL integration, synthetic browser and cross-platform
   CI gates. Save redacted screenshots and a field-type coverage matrix.

## Acceptance Evidence

- Exact read-back includes underlying option values, not only visible labels.
- Upload status distinguishes selected, uploading, accepted and failed.
- Required conditional fields are discovered after reveals and validated.
- Changed semantics, options or units invalidate the prior answer mapping.
- CAPTCHA/MFA fixtures create resumable scoped exceptions while other jobs run.
- Banners and HTTP status cannot mark a submission confirmed.
- Every dry-run fixture leaves zero server-side application submissions, even
  when Enter or a change event attempts an implicit final action.
- A discovered synthetic job reaches READY with a valid P06 packet, exact form
  snapshot and read-back report. P08 can add its commit protocol without
  replacing these checks.
