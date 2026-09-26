import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DryRunResult } from "../../packages/contracts/src/browser.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { DomainError } from "../../packages/contracts/src/index.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { BrowserRepository } from "../../packages/persistence/src/browser-repository.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { DocumentRepository } from "../../packages/persistence/src/document-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { SubmissionRepository } from "../../packages/persistence/src/submission-repository.js";
import {
  documentAssessment,
  documentAuthorization,
  documentFacts,
  documentGenerationInput,
  documentJob,
  documentProfile,
} from "../fixtures/document-packets.js";

function readyBrowserResult(packet: PacketSnapshot): DryRunResult {
  const cv = packet.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!cv) throw new Error("Expected CV PDF.");
  const base = {
    url: "http://127.0.0.1:4320/jobs/standard",
    origin: "http://127.0.0.1:4320",
    jobId: packet.manifest.jobId,
    blocker: "none" as const,
  };
  const first = {
    ...base,
    step: 1,
    fingerprint: "a".repeat(64),
    fields: [
      {
        name: "full_name",
        semanticKey: "full_name",
        label: "Full name",
        kind: "text" as const,
        required: true,
        maxLength: null,
        options: [],
      },
      {
        name: "cv",
        semanticKey: "cv",
        label: "CV",
        kind: "file" as const,
        required: true,
        maxLength: null,
        options: [],
      },
    ],
  };
  const second = {
    ...base,
    step: 2,
    fingerprint: "b".repeat(64),
    fields: [
      {
        name: "sponsorship",
        semanticKey: "sponsorship_required",
        label: "Sponsorship",
        kind: "select" as const,
        required: true,
        maxLength: null,
        options: [{ label: "No", value: "no" }],
      },
    ],
  };
  const firstEntries = [
    {
      name: "full_name",
      semanticKey: "full_name",
      expected: packet.content.cv.identity.fullName,
      evidence: ["fact-identity"],
    },
    { name: "cv", semanticKey: "cv", expected: cv.filename, evidence: [cv.sha256] },
  ];
  const secondEntries = [
    { name: "sponsorship", semanticKey: "sponsorship_required", expected: "no", evidence: [] },
  ];
  return {
    packetId: packet.manifest.id,
    applicationId: packet.manifest.applicationId,
    status: "ready",
    snapshots: [first, second],
    plans: [
      { fingerprint: first.fingerprint, entries: firstEntries, unresolved: [] },
      { fingerprint: second.fingerprint, entries: secondEntries, unresolved: [] },
    ],
    reports: [
      {
        snapshot: first,
        status: "ready",
        readBack: firstEntries.map((entry) => ({
          name: entry.name,
          expected: entry.expected,
          actual: entry.expected,
          matches: true,
        })),
        uploadStatus: "accepted",
        issues: [],
      },
      {
        snapshot: second,
        status: "ready",
        readBack: [{ name: "sponsorship", expected: "no", actual: "no", matches: true }],
        uploadStatus: "idle",
        issues: [],
      },
    ],
    issues: [],
    blockedFinalActions: 0,
    serverApplicationCount: 0,
    preparedAt: "2026-09-17T09:00:00.000Z",
  };
}

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} document packets`,
    () => {
      let db: Database;
      let dir: string;
      let owner: string;
      let documents: DocumentRepository;
      let artifacts: ArtifactStore;

      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-documents-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "documents.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `documents-${randomUUID()}`;
        const candidates = new CandidateRepository(
          db,
          owner,
          () => new Date("2026-09-17T09:00:00.000Z"),
        );
        await candidates.initialize();
        documents = new DocumentRepository(db, owner, () => new Date("2026-09-17T09:00:00.000Z"));
        artifacts = new ArtifactStore(await realpath(dir));
        await artifacts.initialize();
        await db.query(
          "INSERT INTO profile_versions(id,owner_id,candidate_id,revision,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            documentProfile.id,
            owner,
            documentProfile.candidateId,
            documentProfile.revision,
            JSON.stringify(documentProfile),
            documentProfile.createdAt,
          ],
        );
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            documentAuthorization.id,
            owner,
            documentAuthorization.revision,
            JSON.stringify(documentAuthorization),
            documentAuthorization.effectiveAt,
            documentAuthorization.expiresAt,
          ],
        );
        await db.query(
          "UPDATE candidates SET id=$1,active_profile_id=$2,active_authorization_id=$3 WHERE owner_id=$4",
          [documentProfile.candidateId, documentProfile.id, documentAuthorization.id, owner],
        );
        await db.query(
          "INSERT INTO jobs(id,owner_id,employer_id,requisition_id,data,created_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
          [
            documentJob.id,
            owner,
            documentJob.employerId,
            documentJob.requisitionId,
            JSON.stringify(documentJob),
            "2026-09-17T08:00:00.000Z",
          ],
        );
        await db.query(
          "INSERT INTO applications(id,owner_id,candidate_id,job_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,'ELIGIBLE',$5,$5)",
          [
            "application-documents",
            owner,
            documentProfile.candidateId,
            documentJob.id,
            "2026-09-17T08:00:00.000Z",
          ],
        );
        await db.query(
          "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,application_id,revision,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)",
          [
            owner,
            documentAssessment.id,
            documentJob.id,
            documentProfile.id,
            "application-documents",
            JSON.stringify(documentAssessment),
            "synthetic-assessment-hash",
            documentAssessment.createdAt,
          ],
        );
      });

      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });

      it("stores immutable artifacts and invalidates prior packet and intent hashes", async () => {
        const firstInput = { ...documentGenerationInput(), requestedAnswers: [] };
        const first = await buildPacket(artifacts, firstInput);
        expect((await documents.savePacket(first)).manifest.validation.status).toBe("valid");
        await db.query(
          "INSERT INTO intents(id,owner_id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES($1,$2,$3,$4,$5,'{}','synthetic',$6)",
          [
            "intent-documents",
            owner,
            "application-documents",
            first.manifest.id,
            documentAuthorization.id,
            "2026-09-17T09:01:00.000Z",
          ],
        );
        const second = await buildPacket(artifacts, {
          ...firstInput,
          generatedAt: "2026-09-17T09:05:00.000Z",
        });
        await documents.savePacket(second);
        expect(
          await db.query("SELECT reason FROM packet_validity WHERE owner_id=$1 AND packet_id=$2", [
            owner,
            first.manifest.id,
          ]),
        ).toEqual([{ reason: "ARTIFACT_CHANGED" }]);
        expect(
          await db.query("SELECT reason FROM intent_validity WHERE owner_id=$1", [owner]),
        ).toEqual([{ reason: "ARTIFACT_CHANGED" }]);
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            "application-documents",
          ]),
        ).toEqual([{ state: "PREPARED" }]);
        expect((await documents.snapshot()).filter((packet) => packet.valid)).toHaveLength(1);
      });

      it("atomically preserves a valid packet when background preparation races", async () => {
        const input = { ...documentGenerationInput(), requestedAnswers: [] };
        const first = await buildPacket(artifacts, input);
        await documents.savePacket(first);
        expect(await documents.hasValidPacket(documentAssessment.id)).toBe(true);

        const competing = await buildPacket(artifacts, {
          ...input,
          generatedAt: "2026-09-17T09:05:00.000Z",
        });
        const retained = await documents.savePacket(competing, {
          preserveValidAssessment: true,
        });

        expect(retained.manifest.id).toBe(first.manifest.id);
        expect(await db.query("SELECT id FROM packets WHERE owner_id=$1", [owner])).toHaveLength(1);
        expect(
          await db.query("SELECT packet_id FROM packet_validity WHERE owner_id=$1", [owner]),
        ).toEqual([]);
      });

      it("detects bytes changed after persistence and blocks the packet", async () => {
        const built = await buildPacket(artifacts, {
          ...documentGenerationInput(),
          requestedAnswers: [],
        });
        await documents.savePacket(built);
        const artifact = built.manifest.artifacts[0];
        if (!artifact) throw new Error("Expected packet artifact.");
        await writeFile(join(dir, "artifacts", ...artifact.storageKey.split("/")), "tampered");
        await expect(
          documents.artifact(built.manifest.id, artifact.kind, artifacts),
        ).rejects.toThrow("hash verification failed");
        expect((await documents.snapshot())[0]).toMatchObject({
          valid: false,
          invalidReason: "ARTIFACT_HASH_MISMATCH",
        });
      });

      it("stores a packet-bound browser dry run and reaches READY only with exact read-back", async () => {
        const built = await buildPacket(artifacts, {
          ...documentGenerationInput(),
          requestedAnswers: [],
        });
        const packet = await documents.savePacket(built);
        const browser = new BrowserRepository(
          db,
          owner,
          () => new Date("2026-09-17T09:00:00.000Z"),
        );
        const result = readyBrowserResult(packet);
        const saved = await browser.save(result);
        expect(saved.status).toBe("ready");
        expect((await browser.snapshot())[0]?.result.packetId).toBe(packet.manifest.id);
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "READY" }]);
        const falseReadBack = structuredClone(result);
        const field = falseReadBack.reports[1]?.readBack[0];
        if (!field) throw new Error("Expected a second-step read-back.");
        field.actual = "yes";
        await expect(browser.save(falseReadBack)).rejects.toThrow("read-back evidence");
        expect(await browser.snapshot()).toHaveLength(1);
        const repeated = await browser.save(result);
        expect(repeated.status).toBe("ready");
        expect(await browser.snapshot()).toHaveLength(2);
        const challenge = structuredClone(result);
        challenge.status = "challenge";
        const firstReport = challenge.reports[0];
        if (!firstReport) throw new Error("Expected a first-step report.");
        firstReport.status = "challenge";
        firstReport.issues = ["Verification challenge requires owner action."];
        challenge.issues = ["Verification challenge requires owner action."];
        const paused = await browser.save(challenge);
        expect(paused.status).toBe("challenge");
        expect(paused.expiresAt).toBe("2026-09-17T09:15:00.000Z");
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "CHALLENGE_REQUIRED" }]);
        expect((await browser.save(result)).status).toBe("ready");
      });

      it("records intent before a single-use fenced dispatch", async () => {
        for (const fact of documentFacts) {
          await db.query(
            "INSERT INTO fact_versions(owner_id,id,revision,candidate_id,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
            [
              owner,
              fact.id,
              fact.revision,
              documentProfile.candidateId,
              JSON.stringify(fact),
              fact.recordedAt,
            ],
          );
          await db.query("INSERT INTO fact_heads(owner_id,id,revision) VALUES($1,$2,$3)", [
            owner,
            fact.id,
            fact.revision,
          ]);
        }
        const clock = () => new Date("2026-09-17T09:00:00.000Z");
        const queue = new Repository(db, owner, clock);
        await queue.setControl({ submissionsPaused: false });
        const built = await buildPacket(artifacts, {
          ...documentGenerationInput(),
          requestedAnswers: [],
        });
        const packet = await documents.savePacket(built);
        const browser = new BrowserRepository(db, owner, clock);
        const preparation = await browser.save(readyBrowserResult(packet));
        await queue.enqueue({
          type: "submit",
          dedupeKey: `submit:${packet.manifest.applicationId}`,
          applicationId: packet.manifest.applicationId,
          domain: "mock-ats",
        });
        const task = await queue.claim("synthetic-worker", ["submit"]);
        if (!task) throw new Error("Expected a leased submit task.");
        const app = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ])
        )[0];
        const submissions = new SubmissionRepository(db, owner, clock);
        await expect(
          submissions.begin(
            { ...task, fence: task.fence + 1 },
            {
              packetId: packet.manifest.id,
              preparationId: preparation.id,
              expectedRevision: Number(app?.revision),
            },
          ),
        ).rejects.toMatchObject({ code: "LEASE_STALE" });
        const handle = await submissions.begin(task, {
          packetId: packet.manifest.id,
          preparationId: preparation.id,
          expectedRevision: Number(app?.revision),
        });
        expect(handle.fence).toBe(task.fence);
        expect(await submissions.authorizeDispatch(task, handle)).toMatchObject({
          expiresAt: "2026-09-17T09:00:10.000Z",
        });
        await expect(submissions.authorizeDispatch(task, handle)).rejects.toMatchObject({
          code: "LEASE_STALE",
        });
        await db.query(
          "INSERT INTO intent_validity(owner_id,intent_id,invalidated_at,reason) VALUES($1,$2,$3,$4)",
          [owner, handle.intentId, clock().toISOString(), "PROFILE_CHANGED_AFTER_DISPATCH"],
        );
        const recordId = randomUUID();
        const receipt = {
          kind: "mock_ats" as const,
          recordId,
          jobId: packet.manifest.jobId,
          receiptUrl: `http://127.0.0.1:4320/receipts/${recordId}`,
          receivedAt: clock().toISOString(),
          emailHash: createHash("sha256").update(packet.content.cv.identity.email).digest("hex"),
        };
        await expect(
          submissions.confirmMockReceipt(task, handle, { ...receipt, jobId: "wrong-job" }),
        ).rejects.toMatchObject({ code: "RECEIPT_UNCORRELATED" });
        const receiptId = await submissions.confirmMockReceipt(task, handle, receipt);
        expect(receiptId).toBeTruthy();
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "CONFIRMED" }]);
        expect(
          await db.query("SELECT id FROM receipts WHERE owner_id=$1 AND application_id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ id: receiptId }]);
        await queue.complete(task);
      });

      it("revocation after intent prevents dispatch and preserves an uncertain attempt", async () => {
        for (const fact of documentFacts) {
          await db.query(
            "INSERT INTO fact_versions(owner_id,id,revision,candidate_id,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
            [
              owner,
              fact.id,
              fact.revision,
              documentProfile.candidateId,
              JSON.stringify(fact),
              fact.recordedAt,
            ],
          );
          await db.query("INSERT INTO fact_heads(owner_id,id,revision) VALUES($1,$2,$3)", [
            owner,
            fact.id,
            fact.revision,
          ]);
        }
        const clock = () => new Date("2026-09-17T09:00:00.000Z");
        const queue = new Repository(db, owner, clock);
        await queue.setControl({ submissionsPaused: false });
        const built = await buildPacket(artifacts, {
          ...documentGenerationInput(),
          requestedAnswers: [],
        });
        const packet = await documents.savePacket(built);
        const preparation = await new BrowserRepository(db, owner, clock).save(
          readyBrowserResult(packet),
        );
        await queue.enqueue({
          type: "submit",
          dedupeKey: `submit:${packet.manifest.applicationId}`,
          applicationId: packet.manifest.applicationId,
          domain: "mock-ats",
        });
        const task = await queue.claim("synthetic-worker", ["submit"]);
        if (!task) throw new Error("Expected a leased submit task.");
        const app = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ])
        )[0];
        const submissions = new SubmissionRepository(db, owner, clock);
        const handle = await submissions.begin(task, {
          packetId: packet.manifest.id,
          preparationId: preparation.id,
          expectedRevision: Number(app?.revision),
        });
        await new CandidateRepository(db, owner, clock).revokeAuthorization(
          documentAuthorization.id,
        );
        await expect(submissions.authorizeDispatch(task, handle)).rejects.toMatchObject({
          code: "LEASE_STALE",
        });
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "UNKNOWN" }]);
        expect(
          await db.query("SELECT dispatch_started_at FROM attempts WHERE owner_id=$1 AND id=$2", [
            owner,
            handle.attemptId,
          ]),
        ).toEqual([{ dispatch_started_at: null }]);
        const reconcile = await queue.claim("synthetic-reconciler", ["reconcile"]);
        if (!reconcile) throw new Error("Expected a reconciliation task.");
        expect(await submissions.reconcileMockReceipt(reconcile, null)).toBe("needs_review");
        await queue.complete(reconcile);
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "NEEDS_REVIEW" }]);
        expect(
          await db.query("SELECT id FROM receipts WHERE owner_id=$1 AND application_id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([]);
      });

      it("reconciles an accepted but ambiguous attempt without a second final action", async () => {
        for (const fact of documentFacts) {
          await db.query(
            "INSERT INTO fact_versions(owner_id,id,revision,candidate_id,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
            [
              owner,
              fact.id,
              fact.revision,
              documentProfile.candidateId,
              JSON.stringify(fact),
              fact.recordedAt,
            ],
          );
          await db.query("INSERT INTO fact_heads(owner_id,id,revision) VALUES($1,$2,$3)", [
            owner,
            fact.id,
            fact.revision,
          ]);
        }
        const clock = () => new Date("2026-09-17T09:00:00.000Z");
        const queue = new Repository(db, owner, clock);
        await queue.setControl({ submissionsPaused: false });
        const built = await buildPacket(artifacts, {
          ...documentGenerationInput(),
          requestedAnswers: [],
        });
        const packet = await documents.savePacket(built);
        const preparation = await new BrowserRepository(db, owner, clock).save(
          readyBrowserResult(packet),
        );
        await queue.enqueue({
          type: "submit",
          dedupeKey: `submit:${packet.manifest.applicationId}`,
          applicationId: packet.manifest.applicationId,
          domain: "mock-ats",
        });
        const task = await queue.claim("synthetic-worker", ["submit"]);
        if (!task) throw new Error("Expected a leased submit task.");
        const app = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ])
        )[0];
        const submissions = new SubmissionRepository(db, owner, clock);
        const handle = await submissions.begin(task, {
          packetId: packet.manifest.id,
          preparationId: preparation.id,
          expectedRevision: Number(app?.revision),
        });
        await submissions.authorizeDispatch(task, handle);
        await queue.fail(task, new DomainError("COMMIT_UNKNOWN", "Response was lost."));
        const reconcile = await queue.claim("synthetic-reconciler", ["reconcile"]);
        if (!reconcile) throw new Error("Expected a reconciliation task.");
        const recordId = randomUUID();
        const evidence = {
          kind: "mock_ats" as const,
          recordId,
          jobId: packet.manifest.jobId,
          receiptUrl: `http://127.0.0.1:4320/receipts/${recordId}`,
          receivedAt: clock().toISOString(),
          emailHash: createHash("sha256").update(packet.content.cv.identity.email).digest("hex"),
        };
        expect(await submissions.reconcileMockReceipt(reconcile, evidence)).toBe("confirmed");
        await queue.complete(reconcile);
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "CONFIRMED" }]);
        expect(
          await db.query("SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toHaveLength(1);
        expect(
          await db.query("SELECT id FROM receipts WHERE owner_id=$1 AND application_id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toHaveLength(1);
      });
    },
  );
}
