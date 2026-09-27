# P06 Amendment: LLM-Authored Letters

The owner now requires LLM-based cover-letter drafting for real applications.
The earlier deterministic letter is retained only for synthetic demo and
explicit review/fill-only paths; it must not silently satisfy a real
auto-submit policy.

## Contract

- A free, pinned, zero-retention OpenRouter route proposes a role-specific
  opening, motivation, and ordered fact IDs. The model sees only minimized
  approved career facts and the vacancy, never identity or work-authorization
  details. The job description is untrusted data, not an instruction source.
- The program copies contribution claims from approved fact text, binds fact
  revisions, and uses code-owned salutation and closing. Model-authored prose
  must pass a bounded, independent role/company/claim check. Unknown, stale,
  invented, or unsupported text blocks the packet; no deterministic fallback
  may quietly produce an auto-submittable real letter.
- Use the P05 durable daily quota and route ledger for letter calls. A 429 or
  missing compatible free endpoint pauses preparation without paid fallback,
  account rotation, or repeated external calls.
- Persist the model/provider and response hash in the packet manifest. At the
  central final-action gate, require validated LLM provenance for real external
  adapters. Keep historical deterministic packet snapshots readable.
- Evaluate synthetic strong/adjacent/misleading cases, employer-name changes,
  model hallucinations, stale fact revisions, outages, and replay. No personal
  profile or generated real letter enters Git.

## Order

1. Typed proposal, minimized request, and independent compiler/validator.
2. Quota-backed worker call, packet provenance, and no-fallback behavior.
3. Central real-submission gate and cross-engine crash/retry tests.
4. Private live route, output quality, PDF/DOCX, and UI verification.

The live free endpoint remains rate-limited as of 2026-09-27. Code and
synthetic evaluation can advance; production reliability cannot be claimed.
