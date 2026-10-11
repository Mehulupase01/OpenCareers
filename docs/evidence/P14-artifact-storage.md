# Encrypted S3 Artifact Storage

2026-10-11. ArtifactStorage is the shared initialize/put/read/key/close contract.
The existing encrypted filesystem backend remains the Windows/default path.
API document and browser routes, worker preparation/inspection and the packet
repository use the same factory/contract; no new database or submission engine
exists. Packet metadata and relative content-addressed keys remain unchanged.

The optional server backend uses pinned @aws-sdk/client-s3 3.1149.0. It stores
encrypted OCDOC01 bytes using the existing owner/purpose/plaintext-hash-bound
AES-GCM codec. Object keys are beneath
owners/<SHA-256 of owner id>/artifacts/<existing content-addressed key>.
Owner hashes are namespaces, not an IAM security boundary: restrict service
credentials to the intended owner's object prefix and keep the bucket private.

Writes carry a ciphertext checksum and If-None-Match: *. A 412 winner is read
and cryptographically verified instead of overwritten. All successful writes
also require readback; other errors are not treated as success. This follows
[AWS conditional-write semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
An accepted write followed by a failed read can be safely retried as another
conditional write; this is artifact idempotency, not submission replay authority.

Initialization validates the vault key and checks HeadBucket access. HeadBucket
does not prove object write permissions; operations still verify actual writes.
Requests have a 15-second abort signal, two SDK attempts maximum, a two-second
connection timeout and 15-second handler timeout. Stream consumption has its
own 15-second timer and byte limit even without Content-Length. Streams are
destroyed on every exit, and API/worker shutdown destroys SDK clients. These
are network/body bounds, not a guarantee on ambient credential-provider lookup.
Provider details are replaced with a generic storage error before propagation.

## Operator Configuration

Only a keyed server profile can select S3. Existing PostgreSQL, owner token,
non-synced external data directory and HTTPS API origins are still required.
Add these to private deployment configuration, never committed configuration:

```dotenv
AUTOPILOT_ARTIFACT_BACKEND=s3
AUTOPILOT_S3_ENDPOINT=https://storage.example.com
AUTOPILOT_S3_BUCKET=opencareers-artifacts
AUTOPILOT_S3_REGION=eu-west-1
```

The endpoint must be an exact HTTPS origin, without credentials, path, query or
fragment. Incomplete settings and S3 settings under the local backend fail.
Use the AWS SDK credential chain through a reviewed workload identity or private
runtime environment. No credentials are baked into this code or bundles.
General-purpose AWS buckets need ListBucket for
[HeadBucket](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html)
and GetObject/PutObject on the intended prefix; this backend does not delete,
list objects or create buckets. Provider-specific IAM must be reviewed separately.
Directory buckets, access-point ARNs and automatic key rotation are not supported.
Do not switch an existing artifact corpus to S3 without a verified migration:
there is no automatic local-to-remote copy or key migration in this increment.

## Verification And Limits

29 focused cases cover config, remote trust boundaries and the shared storage
contract. Both backends generate valid packets and read back PDF/DOCX artifacts.
The S3 contract uses the actual SDK against a fresh signed-request loopback HTTP
fixture with atomic conditional writes; it is not a live S3/MinIO or IAM test.
Unit cases cover wrong owners, tampering, missing keys, inaccessible buckets,
oversized/missing lengths, stalled streams, generic errors and client cleanup.

Final frozen-code pnpm check: 652 passed / 217 skipped in 84 files; lint/types/
ledger/build pass. Production audit reports no known vulnerabilities. Rebuilt
production-only Windows installation passes its packet, guarded mock receipts,
ambiguity, isolated startup and parent/child drain checks (24.24 seconds).
The earlier mixed-source check had one readiness-test failure and is not evidence.
Successor CI is pending. No real bucket, private profile or model call was used.

P14-02 is in progress; no P14 gate closes. Container topology, TLS deployment,
live service/permission verification, remote handoff, hybrid command transport,
migration, backup/restore and complete server workflow remain unverified or
unimplemented. Counts remain 12/19 phases and 89/128 gates.
