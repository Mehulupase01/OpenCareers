# Job-Board Targets And Operational Coverage

2026-10-11. The coverage API and discovery workspace now expose the 20-board
target catalog, with LinkedIn first and Indeed second. Remaining ordering is
provisional, not a measured popularity ranking or an availability promise.
Every board is explicitly planned, access-unreviewed and non-operational.
A catalog row grants no permission and dispatches no browser or network work.

Employer feeds are separate: nine implemented public-reader families, enabled
owner-scoped live source count, and fresh healthy live source count. Fixture
sources and disabled sources do not count. Freshness requires successful healthy
evidence no older than two configured polling intervals; missing, invalid,
future or stale evidence does not count. Zero-job successful feeds can be healthy.
These figures do not imply LinkedIn/Indeed scanning, Internet-wide coverage or
live submission support. P18 and its 20-operational-source gate remain open.

Full local check: 600 passed, 206 PostgreSQL cases skipped, 73 files; lint,
types, ledger and build passed. Desktop/mobile discovery screenshots were
inspected, including the 20 rows and bounded mobile table scrolling.
Full browser verification and successor CI results are recorded in the handoff.

Preparation-hardening CI 38132799076 failed both OS browser lanes because the
document fixture paused preparation before requesting a manual fill. Its
PostgreSQL lane passed. The corrected fixture first asserts the paused fill is
rejected, resumes preparation, and keeps submission paused until review is done.
The production guard is unchanged. That failed run is not green evidence.

No live board access, private configuration, inference, employer submission,
OAuth grant, startup installation or real-duration soak was performed here.
