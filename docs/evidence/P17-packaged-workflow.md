# Packaged Synthetic Workflow Verification

2026-10-11. The Windows ZIP now ships `dist/scripts/release-smoke.js` and its
explicit compiled dependencies: the existing capacity fixture and one reviewed
synthetic document fixture. No test runner, arbitrary test corpus or private
profile is included. The build imports that fixture for compiled runtime use;
runtime installation remains production-only and needs no TypeScript or tsx.

From the extracted bundle after installing dependencies and Chromium, run:

```powershell
node dist/scripts/release-smoke.js
```

The command accepts no options, never loads an env file, and calls loadConfig
with an empty environment. It creates a canonical fresh TEMP directory with
the existing synthetic-workspace guard and uses one SQLite application store.
It cannot select a real target, an owner profile or an existing data directory.
Private-looking profile/database/data-directory settings were injected into
the test subprocess and ignored; a target override exits with code 1.

Three sequential scenarios use the existing packet, browser, answer guard and
submission authority contracts:

- Normal preparation and authorized mock dispatch produce one correlated receipt.
- Accepted-but-lost response becomes UNKNOWN and is reconciled read-only to
  one receipt, with no second commit attempt or second mock record.
- Changed-question preparation returns needs_input and creates no commit attempt.

The runner asserts two confirmed receipts, zero confirmed-without-receipt,
zero unresolved UNKNOWN outcomes and exactly two confirmed attempts. Each
scenario checks that browsers, contexts and in-flight openings return to zero.
The repository closes in finally; fresh synthetic output remains inspectable.

Local evidence: focused smoke/bundle suite 6/6; full pnpm check 636 passed /
217 skipped in 82 files, lint/types/ledger/build; opt-in production-only
clean-install test 1/1 in 20.63 seconds. That extracted archive also validates
PDF/DOCX packets, refuses an unknown answer, boots the compiled API/dashboard,
and exits the manager and both owned children after authenticated stop.
Public-source scan passes 387 files, including explicit fixture/compiled inputs.
The local draft archive SHA-256 is
06d7fa6d6513910305d6b771f318a183f1170d43f7fcc7bde0501799ec0c65b7.
CI [38156771601](https://github.com/Mehulupase01/OpenCareers/actions/runs/38156771601)
at e5c504caa183d267886e11a7aa2cc0ebaa45174f passed Windows, Ubuntu and PostgreSQL,
including the Windows production-only packaged workflow and browser regressions.
That run does not verify the later S3 backend extension.

This is not job discovery, real fit inference or OpenRouter letter evidence:
assessment and letter content are deterministic reviewed synthetic fixtures.
It is not a clean-machine/fresh-clone proof, crash/challenge demo, server or
hybrid installation, installed logon startup, real-duration soak or genuine
employer submission. All P17 gates remain open; productionReleaseAccepted is
false. The earlier green CI 38155284587 verifies the prior bundle/runtime batch,
not this successor extension. Counts remain 12/19 phases and 89/128 gates.
