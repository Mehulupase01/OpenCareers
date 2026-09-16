# P03 Candidate Evidence And Authorization Verification

2026-09-17. Local verification complete; remote CI pending. All imported documents,
facts, profiles, grants and answers used for verification are synthetic.

## Acceptance Evidence

| Gate | Evidence |
| --- | --- |
| G1: Traceable claims | Strict discriminated fact schemas require owner assertions or exact source/locator/quote provenance. Source quotes are checked against owner-scoped extraction blocks. Extracted claims need review before publication. Cross-owner sources and stale revisions are rejected on both engines. |
| G2: Non-inflated experience | Unit/property tests compare interval union against a set-based month reference. Full-time and part-time totals are separately unioned; their overlap is not double-counted in the overall total. Invalid/future chronology and known impossible technology dates are flagged, never repaired. |
| G3: Revision invalidation | SQLite/PostgreSQL tests publish a changed profile and verify prepared-packet invalidation while retaining original profile/packet snapshots and confirmed history. Changed or expired facts also fail the policy gate before republication. |
| G4: Revocation | Both engines serialize owner policy operations. Tests race a gate check against revocation and prove subsequent checks fail. Repeated revocation is idempotent. Policy creation/revocation fences leased submission work; the future commit engine must call the gate in its authority transaction. |
| G5: Targeted questions | Missing salary and future-sponsorship answers affect only the corresponding application. Current permission is not reused as future sponsorship. Answers bind exact semantics, scope, validity dates and reviewed fact revisions; revisions and expiry are rechecked. |
| G6: Synthetic public data | Runtime private artifacts are ignored and stored outside public source. Generated PDF/DOCX fixtures contain Alex Example and synthetic.example addresses. Public-source scan and manual diff review pass; pattern scans alone are not a privacy guarantee. |
| G7: Readable authorization | Protected export includes exact revision, profile, scope, mode/final-action permission, limits, salary, sponsorship, account/disclosure permissions, effective/expiry/revocation times. Machine-readable active snapshot is available through the protected candidate API. Desktop/mobile tests export and revoke the grant. |

## Checks

- Strict typecheck, Biome format/lint and production build pass.
- Full unit/integration run: 78 passed, zero skipped, both SQLite and PostgreSQL.
- Browser suite: four passed across desktop Chromium and mobile Chromium, including
  existing operations controls. No uncaught page errors or measured horizontal overflow.
- Inspected synthetic desktop/mobile profile screenshots; Playwright emits screenshots
  and failure traces to ignored `test-results`, also collected by CI.
- Multipart API rejects unauthenticated/foreign-origin access, unknown fields and
  oversized uploads. Parser tests preserve byte-identical originals and hashes,
  validate DOCX tables/links and PDF text coordinates, and reject malformed input,
  unsafe XML, oversized files and parser timeouts.
- Production dependency audit reports no known vulnerabilities.
- Migration v3 passes populated-schema upgrade and checksum checks on both engines.

## Boundaries

No employer was contacted and no real candidate file was imported. The policy gate
is a database prerequisite, not an implemented external submission boundary. P08
must verify revocation, fencing and unknown outcomes around actual mock final actions,
then obtain genuine private live receipt evidence for any claimed live support.

PDF text retains coordinates and links, not inferred table semantics; visual review
is mandatory. Scanned content remains unreadable until reviewed transcription/OCR.
DOCX structures retain locators and warn about images, tracked changes and embedded
representations. No automatic factual entailment is claimed: owners review each fact.
Technology-date checks currently cover Python and React only; unknown technologies
are unclassified, not implicitly verified.

The parser runs in a child process with a stripped environment, disabled fetch,
256 MiB JavaScript heap, 15-second timeout and bounded source/archive/text counts.
This is not an OS security sandbox or a hard native-memory cap. Production isolation,
private-volume encryption/ACL validation and broader hostile-input testing remain
P14/P15 gates. Interrupted artifact writes may leave unreferenced private files;
retention/cleanup must only remove files proven unreferenced. The database never
publishes a source until its stored checksum is verified.

## Parser References

- [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [yauzl archive validation](https://github.com/thejoshwolfe/yauzl)
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)
- Technology anchors: [Python history](https://docs.python.org/3/faq/general.html),
  [React versions](https://react.dev/versions).
