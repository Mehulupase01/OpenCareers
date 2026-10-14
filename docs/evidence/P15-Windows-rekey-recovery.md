# Windows Rekey And Reviewed Employer-Account Recovery

2026-10-14. Original phase counts remain12/19 and98/128 gates. This milestone extends
P15-03; it does not close a phase or assert private recovery, a live login or a soak.
Previous archive commit a490251 passes all four CI lanes in38530880216. Android and
new server/hybrid deployment work remain deferred under the owner's Windows-only
instruction; existing cross-platform regression contracts remain intact.

## Fresh-Copy Rekey

The explicit `backup restore-rekey` operation takes a separately configured replacement
vault key over private IPC. It rejects malformed keys and reuse of either the old
vault or backup key before allocating a restore target. Ordinary `restore` ignores
the optional replacement environment setting. No authoritative source/config is
rewritten or resumed.

The authenticated, fully verified archive is extracted into a generated unpublished
directory. The rekey helper refuses an ordinary source directory, redirected files,
unexpected document paths and a mismatched/non-stopped owner. Both encrypted document
kinds are rewritten under the replacement key without changing plaintext hashes,
sizes or database identities. All supported vault purposes are rewrapped with fresh
nonces, incremented per-secret binding versions and a rotation timestamp; updates and
a counts-only audit event commit transactionally. Every document and secret is then
verified with the new key before the ordinary restore quarantine and publication.

An injected failure after document writes but before vault commit leaves no published
copy. The original archive, source documents and source vault rows remain unchanged.
Old keys still recover the original archive. The ready marker/result explicitly
identify whether rekey occurred, without including any key. Activate only by separately
reviewing the fresh data directory and replacement vault-key configuration together.

Local rekey does NOT revoke remote cookies/OAuth tokens/passwords or rotate archive
encryption, owner tokens or OpenRouter keys. Historical encrypted secret rows remain;
neither JavaScript buffers nor SSD deletion constitute guaranteed secure erasure.

## Account Recovery Review

After global external-history review releases restore quarantine, an authenticated
owner may review a still-locked account. Fresh review time must follow the current
lock, optimistic timestamp/state checks must match, and a private evidence hash is
required. No agent, model or background worker receives review authority.

Two dispositions: disable the local account (detach credential access), or
record an existing employer account with exact employer origin, adapter and identity
email correlation, a replacement password and explicit owner verification. The new
credential is sealed, self-verified and stored transactionally; only redacted account
metadata is returned. The audit explicitly says owner_attestation, not provider proof.
No signup/login/employer request or remote account deletion occurs. Old signup attempts stay UNKNOWN and cannot
be replayed, settled or reset to prepared. Closed accounts cannot be recreated by
the deduplicating prepare route.

Review may happen while Global Stop remains enabled. It does not resume processing,
clear submission barriers, restore mailbox consent or revive source/browser sessions.
Credential reads still consult stop/restore controls. Authenticated/Origin-protected
private local API and the existing Accounts panel expose the review; passwords are
masked and cleared on submit/cancel/refresh. They are not returned, audited or logged.
The account-state label no longer misleadingly claims that a confirmed account is
currently signed in.

## Evidence

Focused archive/restore/account/recovery/API contracts:44 passed /16 PostgreSQL
skipped, five files,23.01 seconds. Covers all vault purposes, both document kinds,
old-key refusal on new ciphertext, source/archive preservation, interrupted-rekey
cleanup, wrong replacement keys, direct-source rekey refusal, explicit CLI rekey,
owner/tenant/identity/time/CAS boundaries, sealed replacement credentials, closure,
unchanged uncertain signup history and zero mock employer signup requests.

Targeted Accounts browser checks:4/4 across desktop/narrow layouts,22.6 seconds.
New recovery-form cases use synthetic route responses for UI-only assertions; actual
API auth/sealing/no-external-action behavior is verified separately by integration
tests. Desktop/mobile screenshots were visually inspected; no layout overflow or
overlap, masked passwords, wrapped long origin/checkbox labels. No Android application
or deployment work was performed.

Full frozen `pnpm check` passes858 tests /283 local skips,106 passing files /two
skipped,300.04 seconds; lint/types/ledger/production build pass. Full browser suite
passes72 cases in4.4 minutes. A final copy-only clarification labels closure as
local disabling rather than remote deletion; affected browser checks4/4 pass again
in20.2 seconds, final formatter/build pass. The core858/full72 results precede only
that label change, not a different recovery implementation. Existing helper-any
lint and bundle chunk-size warnings remain.

Separate compiled Node CLI smoke passes archive capture/restore-rekey, encrypted
artifact verification, vault version increment and owner-reviewed account recovery
while Global Stop and submission pause remain true. No TypeScript tooling, private
data or provider request was used. Temporary synthetic storage was removed only
after validating its generated canonical path. Successor CI is pending.

All data and keys in verification are synthetic; no private config/CV/database/secret,
provider consent, employer account or real submission was accessed or modified.

## Remaining

Physical power-loss/reboot and parent-crash staging recovery, nested open-restore
support, provider credential revocation/rotation drills and the full commit-boundary
fault matrix remain. Legacy raw-checksum restore markers without a known archive
capture boundary retain their weaker owner-attestation behavior. P15-G4 therefore
remains open; local rekey/review does not prove external-history completeness or
satisfy24/72-hour acceptance.
