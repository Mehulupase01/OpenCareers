# Threat Model and Concrete Risks

| Risk | Required control | Verification |
| --- | --- | --- |
| Crash after external acceptance | Durable in-flight record, no replay, correlated receipts | T16-T18 crash matrix |
| Stale or concurrent worker | Lease expiry, monotonic fencing, scoped one-use capability | Repository and browser race tests |
| Revoked policy | Check current policy at final boundary, invalidate readiness | T19-T20 |
| JD/document/email prompt injection | Treat content as data; typed proposals without tool authority | T28 |
| Unsafe imported URL | DNS/IP validation, redirect revalidation, network isolation | T29 |
| Local cross-site requests | Owner authentication, Host/Origin checks, CSRF controls | API denial tests |
| Candidate/credential exposure | Redaction, encrypted secrets/artifacts, synthetic-only public files | Secret scan and access tests |
| Paid or privacy-ineligible model | Independent price/capability checks and durable reservations | T10-T11/T30 |
| Old backup permits duplicates | Restore disables new commits until external gap reconciled | T26 |
| Portal form drift | Fingerprint invalidation and adapter-scoped pause | T13-T15/T31 |
| External capacity limits | Honest counters and bounded retries | 24/72-hour soaks |

Private onboarding must establish facts and authorization before real submissions.
Hosting spend, publication, mailbox grants and material personal declarations need
their actual configuration; the build request alone does not supply missing data.
Challenge/access behavior is tracked in docs/amendments.md following the owner's
expanded request. Account ownership, destination validation, candidate truth and
receipt requirements remain necessary for all implementations.
