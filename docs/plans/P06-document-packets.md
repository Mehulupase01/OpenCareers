# P06 Tailored CVs, Letters And Answer Packets

Plan prepared 2026-09-17 from masterplan chapter 09 and phase page 35 after P05
closure. P06 produces reviewable application packets only. P07 consumes the
validated artifacts; P08 owns any external submission action.

## Decisions

- Add strict CV, motivation-letter, claim, answer and packet-manifest schemas. Every
  material sentence or bullet carries approved profile fact IDs and revisions.
  Templates are code-owned versions; model-authored HTML, XML, macros, paths and
  layout instructions are not accepted.
- Generate from the exact P03 profile revision and P05 job/assessment snapshot.
  Identity, employers, titles, employment and education dates, language levels,
  authorization wording and quantified outcomes are copied from approved facts.
  Tailoring may reorder skills, select relevant evidence and compose conservative
  summaries; it may not rewrite fixed facts to resemble the vacancy.
- Rank professional employment evidence before projects. A project is selected only
  when it covers a supported requirement that employment does not. Preserve delivery
  vocabulary such as researched, prototyped, built, deployed and maintained. Years
  of hands-on and full-time professional experience remain separately calculated and
  separately worded.
- Build deterministic packets first. Optional inference may propose supported
  wording through the P05 gateway, but the same independent claim validator must
  accept every proposal. An unavailable model never blocks a packet whose approved
  facts answer all substantive fields; unknown material answers become explicit
  deferred questions rather than guessed text.
- Render DOCX with the pinned `docx` library and PDF with pinned `pdfkit` plus a
  packaged Noto Sans font. Both renderers consume the same immutable AST. DOCX and
  PDF are independently extracted, normalized and compared for candidate facts,
  company, role, dates, numbers, URLs and required sections.
- Use deterministic ATS-friendly templates: ordinary text, semantic headings,
  predictable reading order, no tables for primary CV flow, no essential graphics,
  minimum 10 pt body text and explicit page/margin/line constraints. Layout failure
  blocks the packet; content is never silently deleted or shrunk below constraints.
- Validate PDF page boxes and text bounds with `pdfjs-dist`; validate DOCX ZIP/XML,
  relationships, absence of macros/external content and upload limits. Render
  representative PDFs in Chromium through PDF.js for visual golden and responsive
  review tests.
- Store bytes below the configured private data directory using SHA-256 storage keys
  and atomic temp-file rename. Database rows and manifests are append-only. Exported
  human-readable copies never overwrite originals and are verified against their
  recorded hash.
- A packet manifest binds application, job, profile, assessment, authorization,
  template, validation report, answers and exact artifact hashes. Re-generation with
  any changed artifact hash invalidates prior packet readiness and uncommitted intent
  records without changing historical or submitted artifacts.
- Add a protected Documents workspace with source-versus-tailored review, artifact
  downloads, selected/excluded evidence rationale, answer status, validation results,
  manifest details and exact version/hash labels.

## Implementation Order

1. Add document ASTs, manifests, validation reports and API snapshot contracts, then
   migration v6 for packet artifacts, answer proposals and intent/readiness validity.
2. Implement deterministic evidence selection and generation from immutable profile,
   job and assessment snapshots, including professional-first rationale, concise
   letters, approved semantic-answer reuse and unresolved-question deferral.
3. Implement an independent validator for evidence revisions, immutable facts,
   delivery tense, experience wording, company/role isolation, placeholders,
   sponsorship text, answer lengths and cross-employer leakage.
4. Implement pinned DOCX/PDF renderers, extraction equivalence, page/text bounds,
   format/security/upload checks and atomic content-addressed storage.
5. Implement transactional packet persistence, hash-driven invalidation, worker/API
   orchestration and secure download/export behavior.
6. Add synthetic short/long/no-match packets, long names/URLs, two-page CV,
   sponsorship, character-limited answer, lookalike employer, accented text and
   converter/render failure cases. Commit only synthetic golden artifacts.
7. Add the responsive review/manifest workspace and verify unit, dual-database
   integration, PDF visual goldens, desktop/mobile browser flows, build, audit,
   public scan and cross-platform CI.

## Acceptance Evidence

- Every material claim resolves to current approved fact revisions and an independent
  validator rejects unsupported or upgraded delivery claims.
- Hands-on and professional experience wording is tested independently.
- Representative PDF bounds and visual renders have no clipping, blank pages,
  missing sections or unreadable text.
- Independently extracted DOCX/PDF facts and vacancy references are equivalent.
- Mutated artifact bytes invalidate readiness/intent state transactionally.
- With inference disabled, complete deterministic packets still prepare while
  unresolved substantive answers remain deferred.
- The owner can inspect the exact manifest, differences, evidence rationale and
  immutable downloads that P07 will receive.

