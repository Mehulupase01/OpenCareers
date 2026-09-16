# P03 Candidate Evidence And Standing Authorization

Status: implemented and locally verified; remote CI pending. Source: masterplan page
32 and the conversation amendments. See `docs/evidence/P03-verification.md`.
No private candidate source has been imported yet.

## Delivery Boundary

One stable candidate identity owns immutable reviewed profile revisions. Every
usable claim references an imported source locator or an explicit owner assertion.
One active, versioned authorization defines which future applications may proceed.
The UI supports review-only, fill-only and automatic final submission; the latter is
required product behavior and is wired to the actual submission engine in P08.

## Implementation Order

1. Add typed candidate facts, source references, review states, semantic answers and
   authorization contracts. Separate current work permission, permit expiry and
   future sponsorship. Separate numeric salary expectation, unit/currency and
   willingness to discuss salary. Unknown values remain null, not guessed.
2. Add owner-scoped persistence migrations for original source metadata, immutable
   extracted blocks, facts, profile revisions, active revision pointers and answer
   revisions. Preserve originals and hashes. Imports are content-deduplicated and
   bounded by size, parser time and resource limits; parsing is isolated from the API.
3. Parse PDF and DOCX with maintained structured parsers. Retain page/paragraph/table
   locators, hyperlinks, extraction warnings and source hashes. Scanned/unreadable
   material becomes needs-review. Document text is data, never executable instructions.
4. Validate chronology deterministically. Count unioned employment months, retain
   separate full-time/part-time totals, flag invalid intervals and implausible
   technology dates, and never replace historical facts automatically.
5. Implement profile publication and packet invalidation in one transaction. Keep old
   profile/packet snapshots inspectable; cancel or requeue affected uncommitted work.
   Already in-flight attempts retain their original immutable references and reconcile.
6. Implement standing policy creation, export, expiry and revocation. Record exact
   role/location scope, exclusions, sponsorship wording, salary answers, account
   creation permissions, optional disclosures and daily limits. An auto-submit grant
   is explicit and versioned; changing a mode cannot silently grant more authority.
7. Add a shared policy gate that checks the current control state, authorization
   revision, expiry, profile revision and job scope transactionally. Revocation must
   invalidate new commit authority immediately; already-sent requests remain uncertain
   until reconciled. The P08 engine must call this gate immediately before dispatch.
8. Add owner-authenticated import/review/profile/policy/answer APIs and dashboard views.
   Onboarding groups material ambiguities for one-time resolution; application-specific
   unknowns create targeted exceptions without stopping unrelated work. Export exact
   active authorization as readable text plus a machine-readable revision snapshot.

## Verification

- Same ownership, versioning and invalidation contracts on SQLite and PostgreSQL.
- Synthetic PDF/DOCX fixtures include tables, links, malformed files, missing text,
  duplicate imports, conflicting claims and parser limits. Original bytes stay unchanged.
- Property tests cover overlapping intervals, boundary months and part-time separation.
- Every generated-eligible fact must have reviewed evidence. Expired/conflicting facts
  cannot enter the active generation projection.
- Revocation races with queued work; stale profile and policy revisions fail closed.
- Salary and sponsorship ambiguities block only the affected application and question.
- Desktop/mobile tests cover import, review, profile publication, policy export and
  revocation. All public fixtures, screenshots and CI data remain synthetic.

## External Inputs

Private deployment ultimately needs the owner's source documents, truthful unresolved
answers, account access and recorded standing policy. Engineering and synthetic tests
can proceed without these. A passed synthetic policy test is not a live receipt and
does not establish portal-specific support or CAPTCHA-solving feasibility.
