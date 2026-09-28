# OpenCareers Capabilities Overview - Chat Export

**Date**: 2026-09-28  
**Topic**: Comprehensive Q&A on OpenCareers architecture, job scraping, autonomous applications, and agent capabilities

---

## Table of Contents

1. [High-Level Repository Overview](#high-level-repository-overview)
2. [How It Scrapes Jobs](#how-it-scrapes-jobs)
3. [Autonomous Application Capabilities](#autonomous-application-capabilities)
4. [LinkedIn & Company Page Support](#linkedin--company-page-support)
5. [LLM & Cover Letter Generation](#llm--cover-letter-generation)
6. [Hosted ATS Form Applications](#hosted-ats-form-applications)

---

## High-Level Repository Overview

### What This Is

OpenCareers is a TypeScript job-search and application-operations platform designed to discover vacancies, evaluate candidate fit, generate evidence-backed application documents, prepare browser forms, and eventually submit applications autonomously. It currently supports synthetic demo workflows and a first-party mock ATS; live employer submission adapters are not yet live-verified.

### Stack

- **Language(s):** TypeScript (96.1%) + CSS (3.9%)
- **Framework / runtime:** Node.js 24.21.0, Fastify API, React 19 + Vite web UI
- **Data layer:** SQLite/WAL for local/demo; PostgreSQL for server deployments
- **Browser automation:** Playwright with typed, adapter-based browser preparation
- **Notable libraries:** Zod, better-sqlite3, `pg`, `docx`, `pdfkit`, `pdfjs-dist`, `lucide-react`, OpenRouter transport

### How It's Organized

```
apps/
  api/          Fastify HTTP API (candidate, discovery, documents, matching, browser, operations)
  web/          React operations dashboard (Candidate, Discovery, Matching, Documents workspaces)
  worker/       Durable scheduler for discovery, matching, packet generation, submission, reconciliation

packages/
  browser/      Adapter SDK, form inspection, preparation, Recruitee/Greenhouse support, mock commit
  candidate/    PDF/DOCX import, parsing, fact extraction, immutable profiles, answer memory, policy
  config/       Runtime profiles, environment validation
  contracts/    Shared typed domain and API contracts
  discovery/    Public ATS connectors, normalization, source health, leases, job identity
  documents/    Evidence-bound packet generation, validation, DOCX/PDF rendering, artifact storage
  domain/       Shared domain rules and state transitions
  inference/    OpenRouter model policy, free-route validation, quota control, structured inference
  matching/     Deterministic eligibility gates, semantic evidence, scoring, evaluation
  mock-ats/     First-party synthetic ATS server and receipt records
  observability/ Logging and runtime observability
  persistence/  SQLite/PostgreSQL repositories, migrations, queue leasing, audit/outbox, submission state

docs/
  Architecture, requirements, phase ledger, handoff, security, persistence, plans, adapter support, evidence

scripts/
  Development runner, environment doctor, demo reset, data scan, golden generation

tests/
  Unit, integration, browser E2E, fixtures, helpers
```

### Runtime Architecture

The API starts Fastify, connects to the authoritative application database, seeds synthetic data in demo mode, and serves the React dashboard. The worker claims durable tasks with fencing/lease ownership, runs public discovery, evaluates jobs through matching and inference, creates immutable document packets, and invokes browser adapters for preparation or submission. Submission authority is isolated: intents and attempts are persisted before final action, receipts are correlated independently, and uncertain outcomes create reconciliation work.

**Phases Complete (P00-P07):** Foundation, persistence, candidate onboarding, discovery, matching, document generation, mock-ATS browser preparation.

**In Progress (P08-P09):** Submission engine gates (8/7 complete), portal coverage (Recruitee/Greenhouse/Lever support).

---

## How It Scrapes Jobs

### Discovery Method

OpenCareers discovers jobs by **reading public APIs from three ATS (Applicant Tracking System) platforms only**—it does not scrape HTML or simulate a browser for discovery.

### Supported Sources

**1. Greenhouse** (`packages/discovery/src/connectors.ts`, lines 75–111)
- Endpoint: `https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true`
- Reads complete job board snapshots with optional ETag-based revalidation
- Extracts `internal_job_id`, title, location, HTML content, posting metadata
- Converts HTML descriptions to plain text

**2. Recruitee** (lines 113–150)
- Endpoint: `https://{tenant}.recruitee.com/api/offers/`
- Reads published job offers with metadata (remote/hybrid/on-site flags, descriptions, requirements)
- Identifies jobs by numeric ID and URL slug

**3. Lever** (lines 152–185)
- Endpoint: `https://api.lever.co/v0/postings/{board}` (global) or `https://api.eu.lever.co/v0/postings/{board}` (EU)
- Implements paginated discovery with `skip` and `limit` query params
- Extracts job text, description, categories, lists, workplace types

### Transport & Safety

The `transport.ts` module enforces strict safeguards:

- **Approved hosts only:** Whitelist limited to `boards-api.greenhouse.io`, `api.lever.co`, `api.eu.lever.co`, and Recruitee domains
- **HTTPS + no auth:** Rejects non-HTTPS URLs, ports, credentials
- **DNS safety:** Verifies resolved IPs are public unicast, rejecting private/loopback addresses
- **Response limits:** Caps individual responses at 8 MB and total scan at 32 MB
- **Timeout protection:** 10-second per-request timeout, 60-second overall scan limit
- **Rate-limit handling:** Respects HTTP 429 backoff and calculates retry delays

### Normalization

All three sources are normalized into a common schema:

- **Plain-text conversion:** Converts HTML to readable text using `html-to-text`
- **Location parsing:** Detects Dutch cities, country codes, remote/hybrid/on-site modes
- **Role classification:** Tags roles as "software", "data", or "platform" using alias matching
- **Content addressing:** Digests job data with source-specific IDs to detect duplicates

### Polling Workflow

The discovery runner claims a source lease, calls `pollSource()`, which:

1. Loops up to 100 pages with 250 ms delays between Lever paginated requests
2. Detects repeated posting IDs across pages (pagination drift check)
3. Returns an error or success batch with all jobs, pages of evidence, ETags, and warnings
4. Stores jobs in the database via `repo.ingest()`

### Demo Mode

In demo mode, discovery reads synthetic fixture data instead of live APIs, preventing real network calls during testing.

**Summary:** OpenCareers discovers jobs by making authenticated GET requests to public, read-only job board APIs—**no web scraping, no browser automation, no private credentials**. All transport is bounded, rate-limited, and restricted to three known ATS providers.

---

## Autonomous Application Capabilities

### ❌ Completely Autonomous Application Not Yet Implemented

**Not yet live.** The system is still in development:

#### P08 (Actual Submission) Status

Currently **partially complete** with engineering gates, but **P08-G6 is explicitly "not_started"** (docs/HANDOFF.md, line 654):

> "At least one genuine, appropriate live submission is receipt-verified before the adapter is labeled live-verified."

This requires:
1. A **real, owned employer account**
2. An **appropriate live vacancy**
3. A **verified private receipt** (not mocked)

#### Current State

- ✅ Mock ATS is fully automated
- ❌ Real employer submissions are not live-verified yet

#### Owner Amendment

From docs/amendments.md, line 8-10:
> "Automatic final clicks and real submissions are mandatory... Live verification requires actual private receipts."

---

## LinkedIn & Company Page Support

### ❌ LinkedIn Scraping

**Not supported.** LinkedIn is not in the approved discovery sources. Only three public ATS APIs are supported:
- Greenhouse (via `boards-api.greenhouse.io`)
- Recruitee (via their public Careers Site API)
- Lever (via `api.lever.co`)

LinkedIn would require browser automation, login credentials, and violates their ToS. The code explicitly rejects unapproved origins.

### ❌ Company Career Pages

**Not supported.** Only **public ATS APIs** are discovered. Company career pages (custom sites without API access) require:
- Browser scraping or auth (explicitly rejected in amendments.md)
- CAPTCHA bypass (requested but "feasibility unverified" and "no bypass has been performed")
- Logged-in scraping (requested but "not configured or enabled")

#### What Would Be Needed

To support arbitrary company pages:

```
P10 (Accounts, secure handoffs)     — Login flows, session management
P10 (Challenge handoff)             — CAPTCHA solving (requested, unverified)
P09 (Additional adapters)           — Workday, BambooHR, etc. (each needs custom code)
P15+ (Security & evasion)           — Anti-bot detection, proxy rotation (feasibility unverified)
```

From amendments.md:
> "Owner requests CAPTCHA bypass, anti-bot evasion, proxy rotation...
> Investigate actual portal controls and technically feasible methods separately;
> account access must be owned or authorized.
> Current status: **requested, feasibility unverified. No bypass has been performed.**"

---

## LLM & Cover Letter Generation

### ✅ LLM Cover Letters — Yes, But Deterministically

Cover letters are generated using:

#### 1. Deterministic Templates

From P06 plan, line 27:
> "Templates are code-owned versions; model-authored HTML, XML, macros, paths and layout instructions are not accepted."

#### 2. OpenRouter Free-Only Inference

**packages/inference/src/gateway.ts:**
- Free model/provider allowlist enforced (lines 196-204)
- Structured JSON output with exact character spans for requirements (lines 77-84)
- **No tools or fallbacks** (line 89: `allow_fallbacks: false`)
- Privacy flags enforced: `data_collection: "deny"` + `zdr: true` (lines 91-92)

#### 3. Letter Structure

**packages/documents/src/render.ts**, lines 162-184:
- Salutation, opening, contributions (mapped to approved candidate facts), motivation, practical notes, closing
- All text must reference existing profile facts; model cannot invent claims

#### 4. Independent Claim Validation

From P06 plan, line 24-27:
> "An unavailable model never blocks a packet whose approved facts answer all substantive fields; unknown material answers become explicit deferred questions rather than guessed text."

### Cost & Privacy Controls

- **Free-only routing:** Paid model fallbacks are disabled
- **Privacy enforced:** Zero data retention request (`zdr: true`), data collection denial
- **Quota management:** Daily reservations with concurrent budget tracking
- **Rate-limit backoff:** Bounded 429 retry with exponential backoff

---

## Hosted ATS Form Applications

### ✅ What's Supported

OpenCareers can fill and prepare applications on **hosted ATS platforms** — meaning companies that use third-party ATS services with standardized application forms:

#### 1. Greenhouse Job Board API + Hosted Forms

- **Public read-only form inspection via** `job-boards.greenhouse.io`
- **Form filling via Playwright** (read-only barrier during dry-run)
- **Status:** P09 inspection/fill fixture-tested, **not submission-ready**
- **Evidence:** docs/sources/P09-greenhouse-hosted-form.md shows form analysis on Adyen posting

#### 2. Recruitee Careers Site API

- Direct API integration (GET-only for discovery, fixture-tested for form fill)
- **Status:** P08-P09 in-progress

#### 3. Lever Hosted Forms

- Similar hosted ATS model
- **Status:** Planned P09

### ❌ Custom Company Career Pages

Examples: company-specific sites built on Workday, BambooHR, or custom platforms

**Why Not Supported:**
- No standardized API for form discovery
- Requires browser automation to handle variable form structures
- May require:
  - JavaScript framework reverse-engineering
  - Authentication/login
  - Anti-bot detection (CAPTCHA, rate limiting)
  - Dynamic form conditions

**Current Blockers** (from `greenhouse-prepare.ts`, lines 39-93):
```typescript
// Read-only preparation mode blocks ALL non-GET requests
if (["GET", "HEAD"].includes(route.request().method())) 
  return route.continue();
onBlockedWrite(); // Blocks form submission
return route.fulfill({ status: 409, body: "Read-only preparation blocked this request." });
```

### Real-World Example: Greenhouse Hosted Forms

**Tested:** Adyen Amsterdam software engineer posting on 2026-09-27

**Can Do:**
- ✅ Read form structure (fields, labels, required status)
- ✅ Detect challenges (reCAPTCHA Enterprise detected)
- ✅ Fill text, email, phone, select dropdowns
- ✅ Upload CV file
- ✅ Read back field values
- ✅ Detect form mutations
- ✅ Block writes during "read-only" testing

**Cannot Do:**
- ❌ Submit application (blocked by read-only barrier)
- ❌ Handle CAPTCHA challenges
- ❌ Verify receipts from employer
- ❌ Recover from network failures
- ❌ Handle reCAPTCHA Enterprise

**Current Result** (from lines 57-68 in P09-greenhouse-hosted-form.md):
```
"Hosted CV upload and final receipt verification are not yet supported."
Status: "unsupported" (even after successful fill)
blockedFinalActions: 1 (attempted write blocked)
```

### The Core Issue

**Company pages have no standard structure.** OpenCareers would need to:

1. **Per-company adapter** — Custom code for each company's form layout
2. **Dynamic form handling** — JavaScript-heavy sites, progressive disclosure
3. **Challenge solving** — Currently architecture forbids CAPTCHA bypass
4. **Receipt verification** — How to prove submission succeeded? Unique confirmation ID? Email? Both?
5. **Anti-bot evasion** — Currently not attempted; explicitly rejected in amendments

---

## Current Capabilities Matrix

| Feature | Status | Evidence |
|---------|--------|----------|
| Public ATS discovery (Greenhouse/Recruitee/Lever) | ✅ Live-tested | Read-only samples, API parity |
| Candidate profile import (PDF/DOCX) | ✅ Locally verified | P03 gates pass |
| Deterministic matching gates | ✅ Fixture-tested | 72-case evaluation with 12-case holdout |
| Free-only LLM inference | ✅ Fixture-tested | P05 price validation, quota tracking |
| Evidence-bound CV/letter generation | ✅ Browser-tested | DOCX/PDF equivalence, layout validation |
| DOCX/PDF rendering | ✅ Deterministic | Pinned `docx` + `pdfkit` libraries |
| Mock ATS form filling | ✅ Mock-tested | P07 dry-run gates pass |
| Greenhouse hosted form inspection | ✅ Read-only tested | Adyen form analysis, 17 controls found |
| Greenhouse hosted form filling | ✅ Dry-run tested | Read-back validation, upload status tracking |
| **Actual form submission** | ❌ Blocked | Read-only barrier in place |
| **Real employer receipt verification** | ❌ Not implemented | P08-G6 not_started |
| **CAPTCHA/MFA handling** | ❌ Not implemented | Detected but unsupported |
| **Company custom career pages** | ❌ Not supported | No per-company adapters |
| **LinkedIn support** | ❌ Not supported | Not in approved sources |
| **Login/auth flows** | ❌ Not started | P10 not begun |
| **Multi-agent orchestration** | ❌ Not used | Sequential task model, P12 not started |

---

## Development Roadmap Status

### Complete Phases

- **P00:** Architecture audit and implementation charter
- **P01:** Runnable skeleton, developer experience, CI
- **P02:** Persistence, durable work, audit events
- **P03:** Candidate evidence and standing authorization
- **P04:** Discovery, job identity, historical imports
- **P05:** Free-only inference and evaluated matching
- **P06:** Tailored CVs, letters, answer packets
- **P07:** Mock ATS and browser filling contract

### In Progress

- **P08:** Actual submission vertical slice (7/7 engineering gates, G6 live verification pending)
- **P09:** High-yield portal coverage (Greenhouse/Lever/Recruitee fixtures, read-only tested)

### Not Started

- **P10:** Accounts, secure handoffs, exception resolution
- **P11:** Email integration and receipt reconciliation
- **P12:** Bounded multi-agent orchestration and cost optimization
- **P13–P17:** Unattended operation, deployment, security, outcomes, release

---

## How to Run Locally

**Requirements:** Node 24.21.0 and pnpm 12.4.2

```powershell
npx --yes pnpm@12.4.2 install --frozen-lockfile
npx --yes pnpm@12.4.2 doctor
npx --yes pnpm@12.4.2 dev
```

**Development Services:**
- Web dashboard: http://127.0.0.1:4318
- API: http://127.0.0.1:4317

**Useful Commands:**
```powershell
npx --yes pnpm@12.4.2 check              # Lint, typecheck, test, build
npx --yes pnpm@12.4.2 test:unit          # Unit tests
npx --yes pnpm@12.4.2 test:integration   # Integration tests
npx --yes pnpm@12.4.2 test:e2e           # End-to-end browser tests
npx --yes pnpm@12.4.2 demo:reset         # Reset synthetic data
npx --yes pnpm@12.4.2 build              # Production build
```

**Entry Points:**
- `npx --yes pnpm@12.4.2 api` — Start API only
- `npx --yes pnpm@12.4.2 worker` — Start worker only
- `npx --yes pnpm@12.4.2 dev` — Start all services

---

## Key Design Decisions (ADRs)

1. **ADR-001: Authoritative State** — Database owns all application state; workers claim tasks with fencing tokens
2. **ADR-002: Persistence Parity** — SQLite and PostgreSQL must use identical repository contracts
3. **ADR-003: Browser Commit Authority** — Only submission engine arms one-use capabilities; intent binds everything
4. **ADR-004: Facts & Inference** — Immutable profile versions govern claims; model outputs are proposals, not permissions
5. **ADR-005: Deployment Profiles** — Demo, local, server, hybrid profiles with clear isolation
6. **ADR-006: Small Runtime** — Node 24 LTS, Fastify, React, Playwright, Zod; no frameworks deferred until measured need
7. **ADR-007: Candidate Evidence** — One candidate per owner with immutable fact versions and standing authorization
8. **ADR-008: Discovery Evidence** — Read-only public ATS connectors with source leases and health tracking
9. **ADR-009: Free-Only Inference** — Fixed OpenRouter route with zero-price model enforcement and quota ledger
10. **ADR-010: Evidence-Bound Packets** — Typed AST with fact references; deterministic generation, independent validation
11. **ADR-011: Owned Browser Preparation** — Mock ATS first, adapter SDK for external forms, no CAPTCHA bypass

---

## Security Model

- **No real credentials in Git** — Public demos and CI use synthetic fixtures
- **Private data outside repo** — Candidate CVs, receipts, and account credentials never checked in
- **Read-only discovery** — No authentication required; public API access only
- **Fenced submission authority** — Intent binding, single-use capabilities, revocation gates
- **Privacy enforced** — Zero data retention, data collection denial in inference requests
- **No bypass implementations** — CAPTCHA, anti-bot, proxy rotation requested but not implemented

---

## Next Steps

1. **P08-G6 Verification** — Requires real employer account, live vacancy, and private receipt
2. **P09 Coverage** — Complete Greenhouse/Recruitee/Lever adapter implementations with live evidence
3. **P10 Challenges** — Implement scoped challenge handoffs for CAPTCHA/MFA resolution
4. **P11 Email** — Add email reconciliation for automated receipt verification
5. **P12 Multi-Agent** — Evaluate bounded orchestration for complex tasks
6. **P13+ Deployment** — Unattended Windows operation, live ramp, monitoring

---

## References

- **Repository:** https://github.com/Mehulupase01/OpenCareers
- **Requirements:** docs/requirements.md
- **Architecture:** docs/architecture.md
- **Phase Ledger:** docs/phase-ledger.json
- **Handoff:** docs/HANDOFF.md
- **Amendments:** docs/amendments.md
- **Adapter Support:** docs/adapter-support.md
- **Security:** docs/security/threat-model.md
- **P09 Research:** docs/sources/P09-greenhouse-hosted-form.md

---

**Export Date:** 2026-09-28  
**Chat Participants:** User (Mehulupase01), GitHub Copilot  
**Topics Covered:** High-level overview, job discovery, autonomous applications, LLM integration, form filling capabilities
