# Requirement Traceability

Reference: Job Autopilot Production Masterplan v2.0, 58 pages, 2026-09-16.
The source PDF contains private policy and is intentionally excluded from Git.

| ID | Requirement | Phases | Required evidence |
| --- | --- | --- | --- |
| R01 | Public vacancy ingestion | P04, P09 | Connector fixtures and current read-only sample |
| R02 | Duplicate prevention | P02, P04, P08, P15 | Identity constraints and crash/restart tests |
| R03 | Explainable NL-compatible ranking | P03, P05, P16 | 50 labeled examples, holdout report, hard gate tests |
| R04 | Verified facts and preserved originals | P03, P06 | Provenance, conflict queue, immutable manifests |
| R05 | Truthful tailored CV and letter | P06 | Claim audit, DOCX/PDF equivalence and visual QA |
| R06 | Fill and finally submit | P07-P09 | Mock server records and one private live receipt |
| R07 | Ambiguous commit recovery | P02, P08, P15 | Process-kill matrix and independent receipt evidence |
| R08 | Independent progress around exceptions | P07, P10, P13 | Challenge, unknown-answer and queue isolation tests |
| R09 | Zero paid fallback | P05, P12, P15 | Price firewall, privacy and concurrent budget tests |
| R10 | Run independently of Codex | P13 | Restart, sleep/wake and 24-hour synthetic soak |
| R11 | Local/server/hybrid profiles | P14, P15 | Clean deployment, parity, migration and restore drills |
| R12 | Reproducible sanitized release | P00, P01, P17 | Clean-clone CI, public-data audit, release checksums |

Every phase gate is tracked in phase-ledger.json. Evidence is absent until a test or
inspection actually supports it. All 32 integrated scenarios must be implemented;
passing narrower tests cannot substitute for the full required workflow.
