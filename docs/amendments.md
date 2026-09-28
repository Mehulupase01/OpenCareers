# User Amendments

2026-09-16, conversation authority takes precedence over the attached specification:

1. Use the existing OpenCareers repository currently open in VS Code, confirmed at
   `D:\Mehul-Projects\OpenCareers`. Retain the project name, history and license.
2. Automatic final clicks and real submissions are mandatory. Review-only and
   fill-only are optional operating modes; they do not satisfy the delivery goal.
   Record standing owner policy so routine supported applications proceed without
   per-application confirmation. Live verification requires actual private receipts.
3. Owner requests CAPTCHA bypass, anti-bot evasion, proxy rotation and restricted
   logged-in scraping. This expands the PDF's original portal-access scope.
   Investigate actual portal controls and technically feasible methods separately;
   account access must be owned or authorized. Do not claim universal coverage.
   Keep proxy/session configuration secret, prevent wrong-origin disclosures, and
   retain bounded retries and independent queue progress. External solving services
   require actual provider configuration and budget; none is configured or enabled.
   Each implemented method needs explicit support evidence. Current status: requested,
   feasibility unverified. No bypass or logged-in scraping has been performed.

The source phase ledger is retained verbatim as requirement history. Amendments
override conflicting source scope; future tickets must reference this file.

4. Commit and push to the existing GitHub origin after each completed phase. Every
   commit includes a descriptive title and body with delivered behavior, checks and
   remaining verification. Continue work autonomously between those checkpoints.

5. Real applications require LLM-drafted cover letters using the approved profile,
   resume evidence and specific job description. The earlier deterministic P06
   letter is insufficient for unattended external submissions; keep it for
   synthetic demo and non-committing review paths only. Model downtime must not
   silently substitute a deterministic letter for a real auto-submit packet.

2026-09-28, scope additions and precedence, after the masterplan conformance audit
at `497ca21`:

6. Conversation authority continues to override the attached specification where
   the two conflict. The masterplan is a 2026-09-16 edition; the owner
   instructions recorded here are later and win. `docs/plans/P09-portal-breadth-amendment.md`
   records where a closed masterplan phase was superseded rather than reopened.
7. Portal breadth is required, not optional. Build the public-API families
   Ashby, Teamtailor, SmartRecruiters, Workable, Personio, and Breezy, and the
   account-gated families Workday, SuccessFactors, iCIMS, Jobvite, and BambooHR,
   each through the proven adapter contract. Workday-class portals that the
   masterplan Ch.07 called backlog items are now in scope.
8. Arbitrary company career pages must be usable, not just known ATS families.
   Add a universal hosted-form engine that inspects an approved origin, maps
   labelled controls to semantic keys, and fills recognized low-risk fields.
   Ambiguity must stop preparation as unsupported rather than guess, because a
   mis-mapped control is a false statement to an employer.
9. Owner-account job sources are in scope. The owner has confirmed that
   third-party accounts this system holds a session for are the owner's own
   accounts, and directs that logged-in job discovery and detail ingestion be
   implemented for LinkedIn, Indeed, and comparable boards. This overrides the
   masterplan Ch.02 exclusion of restricted logged-in scraping. Session material
   is a credential: encrypted at rest, never in a prompt, log, audit payload, or
   API response, and excluded from source control.
10. The masterplan Ch.01 exclusions of CAPTCHA solving, challenge-token reuse,
    fingerprint deception, proxy rotation to evade blocks, and anti-bot bypass
    remain in force and are not overridden. Neither is mass automated Easy Apply
    submission through an aggregator funnel. A challenge of any kind is routed
    to the P10 visible handoff: the owner solves it in the owned visible browser
    and automation continues from a fresh context. Employer ATS application flows
    are fully in scope and are the product's central outcome.
11. Free-only inference must use a route that actually works. The owner directs
    use of any free OpenRouter model, or NVIDIA Nemotron 3 Ultra on OpenRouter.
    A live catalogue read on 2026-09-28 found
    `nvidia/nemotron-3-super-120b-a12b:free` advertising zero price in both
    dimensions with `structured_outputs` support, while
    `nvidia/nemotron-3-ultra-550b-a55b:free` is zero-priced without advertised
    structured outputs. Per-route zero-data-retention provider eligibility is
    still unverified and must be probed, not assumed. If no free route satisfies
    zero price, privacy, and capability, that is recorded as an external blocker;
    privacy is never relaxed and paid fallback stays disabled.
12. The owner's OpenRouter key was pasted into chat and must be rotated before any
    live route work. The repository never contains it.

