import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInspectionTask } from "../../apps/worker/src/inspection.js";
import { AdapterRegistry, createAdapterRegistry } from "../../packages/browser/src/adapter-sdk.js";
import { VisibleHandoffBroker } from "../../packages/browser/src/handoff-broker.js";
import type { DryRunResult } from "../../packages/contracts/src/browser.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { DomainError } from "../../packages/contracts/src/index.js";
import type { ReceiptEvidence } from "../../packages/contracts/src/submission.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { compileLetterProposal } from "../../packages/documents/src/letter-draft.js";
import { BrowserRepository } from "../../packages/persistence/src/browser-repository.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { DocumentRepository } from "../../packages/persistence/src/document-repository.js";
import { EmailRepository } from "../../packages/persistence/src/email-repository.js";
import { ExceptionRepository } from "../../packages/persistence/src/exception-repository.js";
import { HandoffRepository } from "../../packages/persistence/src/handoff-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { SubmissionRepository } from "../../packages/persistence/src/submission-repository.js";
import { DocumentStorage } from "../../packages/security/src/document-storage.js";
import {
  documentAssessment,
  documentAuthorization,
  documentFacts,
  documentGenerationInput,
  documentJob,
  documentProfile,
} from "../fixtures/document-packets.js";
import { identity } from "../helpers/candidate-fixtures.js";

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
    adapter: {
      id: "mock-ats",
      version: "mock-ats-v1",
      targetFingerprint: "c".repeat(64),
    },
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

      async function seedProfileFacts() {
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
      }

      async function approveMockScreening(clock: () => Date) {
        await new CandidateRepository(db, owner, clock).saveAnswer({
          semanticKey: "sponsorship_required",
          meaning: "Sponsorship",
          answer: "no",
          validFrom: "2026-09-01",
          validUntil: "2026-10-01",
          employerIds: [documentJob.employerId],
          countries: ["NL"],
          evidenceFactIds: ["fact-work-nl"],
        });
      }

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
        vi.restoreAllMocks();
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });

      it("automatically queues inspection, persists readiness and queues the bound final action", async () => {
        const clock = () => new Date("2026-09-17T09:00:00.000Z");
        const queue = new Repository(db, owner, clock);
        const packet = await documents.savePacket(
          await buildPacket(artifacts, { ...documentGenerationInput(), requestedAnswers: [] }),
        );
        await documents.queueInspection(packet);
        await documents.queueInspection(packet);
        const task = await queue.claim("inspection-worker", ["inspect"]);
        if (!task) throw new Error("Expected inspection task.");
        let prepares = 0;
        const adapters = new AdapterRegistry([
          {
            id: "mock-ats",
            version: "mock-ats-v1",
            parseTarget: (value) => value,
            async prepare(input) {
              prepares++;
              expect(input.approvedValues).toEqual({});
              expect(input.cvPdf.length).toBeGreaterThan(100);
              expect(input.target).toEqual({ fixture: "standard" });
              return readyBrowserResult(input.packet);
            },
            async commit() {
              throw new Error("Inspection must not call commit.");
            },
            async reconcile() {
              throw new Error("Inspection must not reconcile.");
            },
          },
        ]);
        await runInspectionTask(task, {
          config: { profile: "demo", externalSubmissionEnabled: false },
          repository: queue,
          documents,
          browser: new BrowserRepository(db, owner, clock),
          artifacts,
          adapters,
          clock,
        });
        await queue.complete(task);
        expect(prepares).toBe(1);
        const tasks = await db.query(
          "SELECT type,domain,payload FROM tasks WHERE owner_id=$1 ORDER BY type",
          [owner],
        );
        expect(tasks).toHaveLength(2);
        const submit = tasks.find((row) => row.type === "submit");
        expect(submit?.domain).toBe("mock-ats");
        expect(JSON.parse(String(submit?.payload))).toMatchObject({
          packetId: packet.manifest.id,
          fixture: "standard",
        });
        expect(
          (await db.query("SELECT state FROM applications WHERE owner_id=$1", [owner]))[0]?.state,
        ).toBe("READY");
        const current = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1", [owner])
        )[0];
        await expect(
          new BrowserRepository(db, owner, clock).save(readyBrowserResult(packet), {
            expectedRevision: Number(current?.revision) - 1,
          }),
        ).rejects.toMatchObject({ code: "REVISION_STALE" });
        expect(
          await db.query("SELECT id FROM browser_preparations WHERE owner_id=$1", [owner]),
        ).toHaveLength(1);
      });

      it("discards a queued inspection once a newer owner preparation is ready", async () => {
        const clock = () => new Date("2026-09-17T09:00:00.000Z");
        const queue = new Repository(db, owner, clock);
        const packet = await documents.savePacket(
          await buildPacket(artifacts, { ...documentGenerationInput(), requestedAnswers: [] }),
        );
        await documents.queueInspection(packet);
        const browser = new BrowserRepository(db, owner, clock);
        await browser.save(readyBrowserResult(packet));
        const task = await queue.claim("inspection-worker", ["inspect"]);
        if (!task) throw new Error("Expected queued inspection.");
        await runInspectionTask(task, {
          config: { profile: "demo", externalSubmissionEnabled: false },
          repository: queue,
          documents,
          browser,
          artifacts,
          adapters: new AdapterRegistry([]),
          clock,
        });
        await queue.complete(task);
        expect(
          await db.query("SELECT id FROM browser_preparations WHERE owner_id=$1", [owner]),
        ).toHaveLength(1);
        expect(
          (await db.query("SELECT state FROM applications WHERE owner_id=$1", [owner]))[0]?.state,
        ).toBe("READY");
      });

      it("inspects the real mock browser and records an unknown question without submitting", async () => {
        await seedProfileFacts();
        const clock = () => new Date("2026-09-17T09:00:00.000Z");
        const queue = new Repository(db, owner, clock);
        const packet = await documents.savePacket(
          await buildPacket(artifacts, { ...documentGenerationInput(), requestedAnswers: [] }),
        );
        await documents.queueInspection(packet);
        const task = await queue.claim("inspection-worker", ["inspect"]);
        if (!task) throw new Error("Expected inspection task.");
        await runInspectionTask(task, {
          config: { profile: "demo", externalSubmissionEnabled: false },
          repository: queue,
          documents,
          browser: new BrowserRepository(db, owner, clock),
          artifacts,
          adapters: createAdapterRegistry(dir),
          clock,
        });
        await queue.complete(task);
        const inbox = await new ExceptionRepository(db, owner, clock).inbox();
        expect(inbox.some((item) => item.question?.semanticKey === "country")).toBe(true);
        expect(
          await db.query("SELECT id FROM tasks WHERE owner_id=$1 AND type='submit'", [owner]),
        ).toHaveLength(0);
        expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toHaveLength(
          0,
        );
      });

      it("resumes an encrypted owner handoff in fresh contexts and submits only through a new permit", async () => {
        await seedProfileFacts();
        let now = Date.parse("2026-09-17T09:00:00.000Z");
        const clock = () => new Date(now);
        const timer = vi.spyOn(Date, "now").mockImplementation(() => now);
        const key = randomBytes(32).toString("base64");
        const queue = new Repository(db, owner, clock);
        const candidates = new CandidateRepository(db, owner, clock);
        const definitions = [
          {
            semanticKey: "country",
            meaning: "Country",
            answer: "NL",
            evidenceFactIds: ["fact-work-nl"],
          },
          {
            semanticKey: "sponsorship_required",
            meaning: "Will you need sponsorship in the future?",
            answer: "no",
            evidenceFactIds: ["fact-work-nl"],
          },
          {
            semanticKey: "available_from",
            meaning: "Available from",
            answer: "2026-11-01",
            evidenceFactIds: ["fact-availability"],
          },
          {
            semanticKey: "remote_preference",
            meaning: "Remote preference",
            answer: "yes",
            evidenceFactIds: ["fact-identity"],
          },
          {
            semanticKey: "terms",
            meaning: "I confirm these details are accurate",
            answer: true,
            evidenceFactIds: ["fact-identity"],
          },
        ];
        const approvedAnswers = [];
        for (const definition of definitions)
          approvedAnswers.push(
            await candidates.saveAnswer({
              ...definition,
              validFrom: "2026-09-01",
              validUntil: "2026-10-01",
              countries: ["NL"],
              employerIds: [documentJob.employerId],
            }),
          );
        const packet = await documents.savePacket(
          await buildPacket(artifacts, {
            ...documentGenerationInput(),
            approvedAnswers,
            requestedAnswers: definitions.map(({ semanticKey, meaning }) => ({
              semanticKey,
              meaning,
              maxCharacters: null,
              country: "NL",
            })),
          }),
        );
        const adapters = createAdapterRegistry(dir);
        const adapter = adapters.get("mock-ats");
        const cv = await documents.artifact(packet.manifest.id, "cv_pdf", artifacts);
        const browser = new BrowserRepository(db, owner, clock);
        const result = await adapter.prepare({
          packet,
          cvPdf: cv.buffer,
          approvedValues: {},
          target: { fixture: "challenge" },
          validateAnswers: (snapshot, plan) => candidates.validateFormPlan(packet, snapshot, plan),
        });
        expect(result.status).toBe("challenge");
        const preparation = await browser.save(result);
        const handoffs = new HandoffRepository(db, owner, clock, key);
        const created = await handoffs.create({
          applicationId: packet.manifest.applicationId,
          preparationId: preparation.id,
          adapterId: "mock-ats",
          targetFingerprint: result.adapter?.targetFingerprint ?? "",
        });
        const session = await handoffs.claimHandoff(
          created.session.id,
          created.token,
          "browser:fixture",
        );
        const broker = new VisibleHandoffBroker({
          visible: false,
          onOpened: async (page) => {
            await page.getByRole("button", { name: "Continue", exact: true }).click();
          },
        });
        try {
          await broker.open(session, result, "browser:fixture");
          const solved = await broker.verify(session.id, session.generation);
          const cookie = solved.browserSession.cookies[0];
          if (!cookie) throw new Error("Expected a scoped synthetic employer session.");
          await expect(
            handoffs.completeHandoff(session.id, solved.leaseOwner, session.generation, {
              ...solved.browserSession,
              cookies: [{ ...cookie, name: "cf_clearance" }],
            }),
          ).rejects.toMatchObject({ code: "ORIGIN_DENIED" });
          await handoffs.completeHandoff(
            session.id,
            solved.leaseOwner,
            session.generation,
            solved.browserSession,
          );
          await broker.closeAll();
          const encrypted = await db.query(
            "SELECT envelope FROM vault_secrets WHERE owner_id=$1 AND purpose='browser_storage'",
            [owner],
          );
          expect(encrypted).toHaveLength(1);
          expect(JSON.stringify(encrypted)).not.toContain("mock_owner_session");
          await expect(
            handoffs.continuation(session.id, packet.manifest.applicationId, "wrong-packet"),
          ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
          await db.query(
            "UPDATE handoff_sessions SET target_fingerprint=$1 WHERE owner_id=$2 AND id=$3",
            ["f".repeat(64), owner, session.id],
          );
          await expect(
            handoffs.continuation(session.id, packet.manifest.applicationId, packet.manifest.id),
          ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
          await db.query(
            "UPDATE handoff_sessions SET target_fingerprint=$1 WHERE owner_id=$2 AND id=$3",
            [session.targetFingerprint, owner, session.id],
          );
          await db.query("UPDATE authorizations SET revoked_at=$1 WHERE owner_id=$2 AND id=$3", [
            clock().toISOString(),
            owner,
            documentAuthorization.id,
          ]);
          await expect(
            handoffs.continuation(session.id, packet.manifest.applicationId, packet.manifest.id),
          ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
          await db.query("UPDATE authorizations SET revoked_at=NULL WHERE owner_id=$1 AND id=$2", [
            owner,
            documentAuthorization.id,
          ]);
          now += 1000;
          const inspect = await queue.claim("resumed-worker", ["inspect"]);
          if (!inspect) throw new Error("Expected handoff inspection.");
          const raced = new AdapterRegistry([
            {
              id: adapter.id,
              version: adapter.version,
              parseTarget: (input) => adapter.parseTarget(input),
              prepare: async (input) => {
                const fresh = await adapter.prepare(input);
                await db.query(
                  "UPDATE handoff_sessions SET generation=generation+1 WHERE owner_id=$1 AND id=$2",
                  [owner, session.id],
                );
                return fresh;
              },
              commit: (input) => adapter.commit(input),
              reconcile: (input) => adapter.reconcile(input),
            },
          ]);
          await expect(
            runInspectionTask(inspect, {
              config: { profile: "demo", externalSubmissionEnabled: false, vaultKey: key },
              repository: queue,
              documents,
              browser,
              artifacts,
              adapters: raced,
              clock,
            }),
          ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
          expect((await browser.snapshot()).some((item) => item.status === "ready")).toBe(false);
          expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toHaveLength(
            0,
          );
          await db.query("UPDATE handoff_sessions SET generation=$1 WHERE owner_id=$2 AND id=$3", [
            session.generation + 1,
            owner,
            session.id,
          ]);
          await runInspectionTask(inspect, {
            config: { profile: "demo", externalSubmissionEnabled: false, vaultKey: key },
            repository: queue,
            documents,
            browser,
            artifacts,
            adapters,
            clock,
          });
          await queue.complete(inspect);
          expect((await handoffs.snapshot()).find((item) => item.id === session.id)?.state).toBe(
            "completed",
          );
          const ready = (await browser.snapshot()).find((item) => item.status === "ready");
          if (!ready)
            throw new Error(
              `Expected fresh readiness after the owner handoff: ${JSON.stringify((await browser.snapshot()).map((item) => ({ status: item.status, issues: item.result.issues, unresolved: item.result.plans.map((plan) => plan.unresolved) })))}`,
            );
          expect(ready.result.snapshots.every((item) => item.blocker === "none")).toBe(true);
          expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toHaveLength(
            0,
          );
          await queue.setControl({ submissionsPaused: false });
          const task = await queue.claim("submission-worker", ["submit"]);
          if (!task) throw new Error("Expected separately authorized submit work.");
          const revision = Number(
            (
              await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
                owner,
                packet.manifest.applicationId,
              ])
            )[0]?.revision,
          );
          const submissions = new SubmissionRepository(db, owner, clock);
          const handle = await submissions.begin(task, {
            packetId: packet.manifest.id,
            preparationId: ready.id,
            expectedRevision: revision,
          });
          const outcome = await adapter.commit({
            packet,
            cvPdf: cv.buffer,
            preparation: ready,
            target: { fixture: "challenge" },
            browserSession: await handoffs.continuation(
              session.id,
              packet.manifest.applicationId,
              packet.manifest.id,
            ),
            validateAnswers: (snapshot, plan) =>
              candidates.validateFormPlan(packet, snapshot, plan, handle),
            authorizeDispatch: () => submissions.authorizeDispatch(task, handle),
          });
          if (outcome.status !== "confirmed")
            throw new Error("Expected a synthetic server receipt.");
          await submissions.confirmReceipt(task, handle, outcome.evidence);
          await queue.complete(task);
          expect(await db.query("SELECT id FROM receipts WHERE owner_id=$1", [owner])).toHaveLength(
            1,
          );
          now += 16 * 60 * 1000;
          await expect(
            handoffs.continuation(session.id, packet.manifest.applicationId, packet.manifest.id),
          ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
        } finally {
          await broker.closeAll();
          timer.mockRestore();
        }
      });

      it("regenerates a packet when its exact answer approval was superseded", async () => {
        await seedProfileFacts();
        const clock = () => new Date("2026-09-17T09:00:00.000Z");
        const candidates = new CandidateRepository(db, owner, clock);
        const input = {
          semanticKey: "country",
          meaning: "Country",
          answer: "NL",
          validFrom: "2026-09-01",
          validUntil: "2026-10-01",
          countries: ["NL"],
          employerIds: [documentJob.employerId],
          evidenceFactIds: ["fact-work-nl"],
        };
        const approved = await candidates.saveAnswer(input);
        const packet = await documents.savePacket(
          await buildPacket(artifacts, {
            ...documentGenerationInput(),
            approvedAnswers: [approved],
            requestedAnswers: [
              {
                semanticKey: input.semanticKey,
                meaning: input.meaning,
                maxCharacters: null,
                country: "NL",
              },
            ],
          }),
        );
        await candidates.saveAnswer({ ...input, answer: "DE" });
        await documents.queueInspection(packet);
        const queue = new Repository(db, owner, clock);
        const task = await queue.claim("inspection-worker", ["inspect"]);
        if (!task) throw new Error("Expected inspection task.");
        const browser = new BrowserRepository(db, owner, clock);
        await runInspectionTask(task, {
          config: { profile: "demo", externalSubmissionEnabled: false },
          repository: queue,
          documents,
          browser,
          artifacts,
          adapters: createAdapterRegistry(dir),
          clock,
        });
        await queue.complete(task);
        const refresh = await db.query(
          "SELECT payload FROM tasks WHERE owner_id=$1 AND type='prepare'",
          [owner],
        );
        expect(refresh).toHaveLength(1);
        expect(JSON.parse(String(refresh[0]?.payload))).toMatchObject({
          refreshAnswers: true,
          assessmentId: packet.manifest.assessmentId,
        });
        expect(
          (await browser.snapshot())[0]?.result.plans[0]?.entries.some(
            (entry) => entry.semanticKey === "country",
          ),
        ).toBe(false);
        expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toHaveLength(
          0,
        );
      });

      it.each([
        {
          name: "exact approval",
          meaning: "Do you require sponsorship?",
          employerIds: [documentJob.employerId],
          countries: ["NL"],
          validUntil: "2026-10-01",
          value: "no",
          accepted: true,
        },
        {
          name: "future sponsorship wording",
          meaning: "Will you require future employer sponsorship in NL?",
          employerIds: [],
          countries: [],
          validUntil: "2026-10-01",
          value: "no",
          accepted: false,
        },
        {
          name: "current work authorization",
          meaning: "Are you currently authorized to work?",
          employerIds: [],
          countries: [],
          validUntil: "2026-10-01",
          value: "no",
          accepted: false,
        },
        {
          name: "nationality wording",
          meaning: "What is your nationality?",
          employerIds: [],
          countries: [],
          validUntil: "2026-10-01",
          value: "no",
          accepted: false,
        },
        {
          name: "other employer",
          meaning: "Do you require sponsorship?",
          employerIds: ["another-employer"],
          countries: [],
          validUntil: "2026-10-01",
          value: "no",
          accepted: false,
        },
        {
          name: "other country",
          meaning: "Do you require sponsorship?",
          employerIds: [],
          countries: ["DE"],
          validUntil: "2026-10-01",
          value: "no",
          accepted: false,
        },
        {
          name: "expired approval",
          meaning: "Do you require sponsorship?",
          employerIds: [],
          countries: [],
          validUntil: "2026-09-16",
          value: "no",
          accepted: false,
        },
        {
          name: "contradictory map value",
          meaning: "Do you require sponsorship?",
          employerIds: [],
          countries: [],
          validUntil: "2026-10-01",
          value: "yes",
          accepted: false,
        },
      ])(
        "checks $name before any field is filled",
        async ({ meaning, employerIds, countries, validUntil, value, accepted }) => {
          await seedProfileFacts();
          const candidates = new CandidateRepository(
            db,
            owner,
            () => new Date("2026-09-17T09:00:00.000Z"),
          );
          const packet = await documents.savePacket(
            await buildPacket(artifacts, { ...documentGenerationInput(), requestedAnswers: [] }),
          );
          await candidates.saveAnswer({
            semanticKey: "sponsorship_required",
            meaning,
            answer: "no",
            employerIds,
            countries,
            validFrom: "2026-09-01",
            validUntil,
            evidenceFactIds: ["fact-work-nl"],
          });
          const snapshot = readyBrowserResult(packet).snapshots[1];
          const field = snapshot?.fields[0];
          if (!snapshot || !field) throw new Error("Expected screening step.");
          field.label = "Do you require sponsorship?";
          field.options = [
            { label: "No", value: "no" },
            { label: "Yes", value: "yes" },
          ];
          const checked = await candidates.validateFormPlan(packet, snapshot, {
            fingerprint: snapshot.fingerprint,
            unresolved: [],
            entries: [
              {
                name: "sponsorship",
                semanticKey: "sponsorship_required",
                expected: value,
                evidence: ["fact-work-nl"],
              },
            ],
          });
          expect(checked.entries).toHaveLength(accepted ? 1 : 0);
          expect(checked.unresolved).toEqual(accepted ? [] : ["sponsorship_required"]);
          if (accepted) {
            const fact = documentFacts.find((item) => item.id === "fact-work-nl");
            if (!fact) throw new Error("Expected work authorization evidence.");
            await db.query(
              "INSERT INTO fact_versions(owner_id,id,revision,candidate_id,data,created_at) VALUES($1,$2,2,$3,$4,$5)",
              [
                owner,
                fact.id,
                documentProfile.candidateId,
                JSON.stringify({ ...fact, revision: 2 }),
                fact.recordedAt,
              ],
            );
            await db.query("UPDATE fact_heads SET revision=2 WHERE owner_id=$1 AND id=$2", [
              owner,
              "fact-work-nl",
            ]);
            await expect(
              candidates.validateFormPlan(packet, snapshot, checked),
            ).rejects.toMatchObject({ code: "PROFILE_STALE" });
          }
        },
      );

      it("does not treat an identity semantic key as approval for different wording", async () => {
        await seedProfileFacts();
        const packet = await documents.savePacket(
          await buildPacket(artifacts, { ...documentGenerationInput(), requestedAnswers: [] }),
        );
        const result = readyBrowserResult(packet);
        const snapshot = result.snapshots[0];
        const field = snapshot?.fields[0];
        const plan = result.plans[0];
        if (!snapshot || !field || !plan) throw new Error("Expected identity step.");
        field.label = "What is your nationality?";
        const candidates = new CandidateRepository(
          db,
          owner,
          () => new Date("2026-09-17T09:00:00.000Z"),
        );
        const checked = await candidates.validateFormPlan(packet, snapshot, plan);
        expect(checked.entries.map((entry) => entry.semanticKey)).toEqual(["cv"]);
        expect(checked.unresolved).toContain("full_name");
      });

      it("excludes an approved answer that is scoped to a different employer", async () => {
        const evidenceFact = await new CandidateRepository(
          db,
          owner,
          () => new Date("2026-09-17T09:00:00.000Z"),
        ).saveFact(identity);
        const save = async (semanticKey: string, employerIds: string[], countries: string[]) =>
          new CandidateRepository(db, owner, () => new Date("2026-09-17T09:00:00.000Z")).saveAnswer(
            {
              semanticKey,
              meaning: `Meaning for ${semanticKey}`,
              answer: "approved wording",
              validFrom: "2026-09-01",
              validUntil: "2026-10-01",
              employerIds,
              countries,
              evidenceFactIds: [evidenceFact.id],
            },
          );
        await save("sponsorship.future", ["a-different-employer"], ["NL"]);
        await save("notice.period", [], []);

        const input = await documents.generationInput(
          "application-documents",
          documentAssessment.id,
          [],
          "2026-09-17",
        );
        expect(input.approvedAnswers.map((answer) => answer.semanticKey)).toEqual([
          "notice.period",
        ]);

        // The packet itself must not carry the other employer's wording.
        const packet = await buildPacket(artifacts, input);
        expect(JSON.stringify(packet.content.answers)).not.toContain("sponsorship.future");
      });

      it("requires an LLM packet when checking readiness for private preparation", async () => {
        const input = { ...documentGenerationInput(), requestedAnswers: [] };
        const deterministic = await buildPacket(artifacts, input);
        await documents.savePacket(deterministic);
        expect(await documents.hasValidPacket(input.assessment.id)).toBe(true);
        expect(await documents.hasValidPacket(input.assessment.id, true)).toBe(false);
        const content = generatePacketContent(input);
        const letter = compileLetterProposal(input, content, {
          opening: content.letter.opening,
          motivation: "The role's focus on Python makes this opportunity compelling.",
          contributionIds: [content.letter.contributions[0]?.id],
        });
        const llm = await buildPacket(artifacts, input, {
          letter,
          modelId: "synthetic/model:free",
          provider: "synthetic",
          responseHash: "a".repeat(64),
        });
        const saved = await documents.savePacket(llm, { preserveValidAssessment: true });
        expect(saved.manifest.letterGeneration?.method).toBe("llm");
        expect(await documents.hasValidPacket(input.assessment.id, true)).toBe(true);
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

      it("does not misclassify missing encryption configuration or legacy migration as packet corruption", async () => {
        const built = await buildPacket(artifacts, {
          ...documentGenerationInput(),
          requestedAnswers: [],
        });
        await documents.savePacket(built);
        const artifact = built.manifest.artifacts[0];
        if (!artifact) throw new Error("Expected synthetic artifact");
        for (const key of [undefined, randomBytes(32).toString("base64")]) {
          const encrypted = new ArtifactStore(
            dir,
            new DocumentStorage(owner, "document_artifact", true, key),
          );
          await encrypted.initialize();
          await expect(
            documents.artifact(built.manifest.id, artifact.kind, encrypted),
          ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
          expect((await documents.get(built.manifest.id)).valid).toBe(true);
        }
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
        const recruitee = structuredClone(result);
        recruitee.snapshots = [recruitee.snapshots[0] as (typeof recruitee.snapshots)[number]];
        recruitee.plans = [recruitee.plans[0] as (typeof recruitee.plans)[number]];
        recruitee.reports = [recruitee.reports[0] as (typeof recruitee.reports)[number]];
        recruitee.adapter = {
          id: "recruitee",
          version: "recruitee-careers-v1",
          targetFingerprint: "d".repeat(64),
        };
        const recruiteeSnapshot = recruitee.snapshots[0];
        const recruiteeReport = recruitee.reports[0];
        if (!recruiteeSnapshot || !recruiteeReport)
          throw new Error("Expected a Recruitee preparation step.");
        recruiteeSnapshot.url = "https://synthetic.recruitee.com/api/offers/software-engineer";
        recruiteeSnapshot.origin = "https://synthetic.recruitee.com";
        recruiteeReport.snapshot = recruiteeSnapshot;
        recruiteeReport.uploadStatus = "selected";
        expect(
          (
            await browser.save(recruitee, {
              queueSubmit: {
                adapterId: "recruitee",
                target: { tenant: "synthetic", offerSlug: "software-engineer" },
              },
            })
          ).status,
        ).toBe("ready");
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
        const queued = (
          await db.query(
            "SELECT domain,payload,state FROM tasks WHERE owner_id=$1 AND type='submit'",
            [owner],
          )
        )[0];
        expect(queued).toMatchObject({ domain: "recruitee", state: "ready" });
        expect(JSON.parse(String(queued?.payload))).toMatchObject({
          tenant: "synthetic",
          offerSlug: "software-engineer",
        });
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
        await approveMockScreening(clock);
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
        const candidates = new CandidateRepository(db, owner, clock);
        await candidates.saveAnswer({
          semanticKey: "sponsorship_required",
          meaning: "Sponsorship",
          answer: "yes",
          validFrom: "2026-09-01",
          validUntil: "2026-10-01",
          employerIds: [documentJob.employerId],
          countries: ["NL"],
          evidenceFactIds: ["fact-work-nl"],
        });
        await expect(submissions.authorizeDispatch(task, handle)).rejects.toMatchObject({
          code: "ANSWER_UNKNOWN",
        });
        expect(
          await db.query("SELECT dispatch_started_at FROM attempts WHERE owner_id=$1 AND id=$2", [
            owner,
            handle.attemptId,
          ]),
        ).toEqual([{ dispatch_started_at: null }]);
        await approveMockScreening(clock);
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

      it("stops pre-dispatch drift without an unknown outcome and permits fresh preparation", async () => {
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
        let now = Date.parse("2026-09-17T09:00:00.000Z");
        const clock = () => new Date(now);
        const queue = new Repository(db, owner, clock);
        await queue.setControl({ submissionsPaused: false });
        const built = await buildPacket(artifacts, {
          ...documentGenerationInput(),
          requestedAnswers: [],
        });
        const packet = await documents.savePacket(built);
        const browser = new BrowserRepository(db, owner, clock);
        const first = await browser.save(readyBrowserResult(packet));
        await approveMockScreening(clock);
        const submissions = new SubmissionRepository(db, owner, clock);
        const lease = async (preparationId: string) => {
          await queue.enqueue({
            type: "submit",
            dedupeKey: `submit:${preparationId}`,
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
          const handle = await submissions.begin(task, {
            packetId: packet.manifest.id,
            preparationId,
            expectedRevision: Number(app?.revision),
          });
          return { task, handle };
        };
        const initial = await lease(first.id);
        const intent = (
          await db.query("SELECT sha256 FROM intents WHERE owner_id=$1 AND id=$2", [
            owner,
            initial.handle.intentId,
          ])
        )[0];
        if (typeof intent?.sha256 !== "string") throw new Error("Expected an intent hash.");
        await db.query("UPDATE intents SET sha256='tampered' WHERE owner_id=$1 AND id=$2", [
          owner,
          initial.handle.intentId,
        ]);
        await expect(
          submissions.abortBeforeDispatch(initial.task, initial.handle),
        ).rejects.toMatchObject({
          code: "FORM_CHANGED",
        });
        await db.query("UPDATE intents SET sha256=$1 WHERE owner_id=$2 AND id=$3", [
          intent.sha256,
          owner,
          initial.handle.intentId,
        ]);
        await submissions.abortBeforeDispatch(
          initial.task,
          initial.handle,
          "RECRUITEE_FIELDS_CHANGED",
        );
        expect((await queue.summary("demo")).applications).toContainEqual(
          expect.objectContaining({
            id: packet.manifest.applicationId,
            driftReason: "RECRUITEE_FIELDS_CHANGED",
          }),
        );
        await expect(
          submissions.authorizeDispatch(initial.task, initial.handle),
        ).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "UNSUPPORTED" }]);
        expect(
          await db.query("SELECT state,dispatch_started_at FROM attempts WHERE owner_id=$1", [
            owner,
          ]),
        ).toEqual([{ state: "BLOCKED_BEFORE_DISPATCH", dispatch_started_at: null }]);
        expect(await db.query("SELECT id FROM receipts WHERE owner_id=$1", [owner])).toEqual([]);
        expect((await queue.cancelTask(initial.task.id)).state).toBe("completed");

        now += 1000;
        const second = await browser.save(readyBrowserResult(packet));
        const repeated = await lease(second.id);
        await submissions.abortBeforeDispatch(repeated.task, repeated.handle);
        const secondIntent = (
          await db.query("SELECT sha256 FROM intents WHERE owner_id=$1 AND id=$2", [
            owner,
            repeated.handle.intentId,
          ])
        )[0];
        if (typeof secondIntent?.sha256 !== "string") throw new Error("Expected an intent hash.");
        await db.query("UPDATE intents SET sha256='tampered' WHERE owner_id=$1 AND id=$2", [
          owner,
          repeated.handle.intentId,
        ]);
        await expect(queue.complete(repeated.task)).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        await db.query("UPDATE intents SET sha256=$1 WHERE owner_id=$2 AND id=$3", [
          secondIntent.sha256,
          owner,
          repeated.handle.intentId,
        ]);
        await queue.complete(repeated.task);

        now += 1000;
        const fresh = await browser.save(readyBrowserResult(packet));
        const resumed = await lease(fresh.id);
        await submissions.authorizeDispatch(resumed.task, resumed.handle);
        await expect(
          submissions.abortBeforeDispatch(resumed.task, resumed.handle),
        ).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        await queue.fail(resumed.task, new DomainError("COMMIT_UNKNOWN", "Response was lost."));
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "UNKNOWN" }]);
      });

      it("correlates a Recruitee candidate receipt to its prepared offer", async () => {
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
        const result = readyBrowserResult(packet);
        result.snapshots = [result.snapshots[0] as (typeof result.snapshots)[number]];
        result.plans = [result.plans[0] as (typeof result.plans)[number]];
        result.reports = [result.reports[0] as (typeof result.reports)[number]];
        result.adapter = {
          id: "recruitee",
          version: "recruitee-careers-v1",
          targetFingerprint: "d".repeat(64),
        };
        const snapshot = result.snapshots[0];
        const report = result.reports[0];
        if (!snapshot || !report) throw new Error("Expected a Recruitee preparation step.");
        snapshot.url = "https://synthetic.recruitee.com/api/offers/software-engineer";
        snapshot.origin = "https://synthetic.recruitee.com";
        report.snapshot = snapshot;
        report.uploadStatus = "selected";
        const preparation = await new BrowserRepository(db, owner, clock).save(result);
        await queue.enqueue({
          type: "submit",
          dedupeKey: `submit:${packet.manifest.applicationId}`,
          applicationId: packet.manifest.applicationId,
          domain: "recruitee",
        });
        const task = await queue.claim("synthetic-worker", ["submit"]);
        if (!task) throw new Error("Expected a leased submit task.");
        const app = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ])
        )[0];
        await approveMockScreening(clock);
        const submissions = new SubmissionRepository(db, owner, clock);
        await expect(
          submissions.begin(
            { ...task, domain: "mock-ats" },
            {
              packetId: packet.manifest.id,
              preparationId: preparation.id,
              expectedRevision: Number(app?.revision),
            },
          ),
        ).rejects.toMatchObject({ code: "FORM_CHANGED" });
        const handle = await submissions.begin(task, {
          packetId: packet.manifest.id,
          preparationId: preparation.id,
          expectedRevision: Number(app?.revision),
        });
        await submissions.authorizeDispatch(task, handle);
        const evidence = {
          kind: "recruitee" as const,
          candidateId: 8123,
          tenant: "synthetic",
          offerSlug: "software-engineer",
          jobId: packet.manifest.jobId,
          responseUrl:
            "https://synthetic.recruitee.com/api/offers/software-engineer/candidates?async=true",
          receivedAt: clock().toISOString(),
          emailHash: createHash("sha256").update(packet.content.cv.identity.email).digest("hex"),
        };
        await expect(
          submissions.confirmRecruiteeReceipt(task, handle, {
            ...evidence,
            offerSlug: "different-offer",
          }),
        ).rejects.toMatchObject({ code: "RECEIPT_UNCORRELATED" });
        const receiptId = await submissions.confirmRecruiteeReceipt(task, handle, evidence);
        expect(receiptId).toBeTruthy();
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "CONFIRMED" }]);
        expect(
          await db.query("SELECT evidence FROM receipts WHERE owner_id=$1 AND id=$2", [
            owner,
            receiptId,
          ]),
        ).toEqual([{ evidence: JSON.stringify(evidence) }]);
        await queue.complete(task);
      });

      it("correlates a Greenhouse receipt to its exact board and posting", async () => {
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
        const clock = () => new Date("2026-09-28T09:00:00.000Z");
        const queue = new Repository(db, owner, clock);
        await queue.setControl({ submissionsPaused: false });
        const built = await buildPacket(artifacts, {
          ...documentGenerationInput(),
          requestedAnswers: [],
        });
        const packet = await documents.savePacket(built);
        const result = readyBrowserResult(packet);
        result.snapshots = [result.snapshots[0] as (typeof result.snapshots)[number]];
        result.plans = [result.plans[0] as (typeof result.plans)[number]];
        result.reports = [result.reports[0] as (typeof result.reports)[number]];
        result.adapter = {
          id: "greenhouse",
          version: "greenhouse-hosted-v1",
          targetFingerprint: "e".repeat(64),
        };
        const snapshot = result.snapshots[0];
        const report = result.reports[0];
        if (!snapshot || !report) throw new Error("Expected a Greenhouse preparation step.");
        snapshot.url = "https://job-boards.greenhouse.io/synthetic-board/jobs/123456";
        snapshot.origin = "https://job-boards.greenhouse.io";
        report.snapshot = snapshot;
        report.uploadStatus = "selected";
        const preparation = await new BrowserRepository(db, owner, clock).save(result);
        await queue.enqueue({
          type: "submit",
          dedupeKey: `submit:${packet.manifest.applicationId}`,
          applicationId: packet.manifest.applicationId,
          domain: "greenhouse",
        });
        const task = await queue.claim("synthetic-worker", ["submit"]);
        if (!task) throw new Error("Expected a leased Greenhouse task.");
        const app = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ])
        )[0];
        await approveMockScreening(clock);
        const submissions = new SubmissionRepository(db, owner, clock);
        const handoffId = randomUUID();
        await db.query(
          "INSERT INTO handoff_sessions(owner_id,id,application_id,preparation_id,adapter_id,target_fingerprint,token_hash,state,generation,expires_at,created_at) VALUES($1,$2,$3,$4,'greenhouse',$5,$6,'open',1,$7,$8)",
          [
            owner,
            handoffId,
            packet.manifest.applicationId,
            preparation.id,
            result.adapter?.targetFingerprint ?? "e".repeat(64),
            "f".repeat(64),
            "2026-09-28T09:10:00.000Z",
            clock().toISOString(),
          ],
        );
        await expect(
          submissions.begin(task, {
            packetId: packet.manifest.id,
            preparationId: preparation.id,
            expectedRevision: Number(app?.revision),
          }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        // A handoff that has completed does not by itself unblock the final action.
        // The preparation predates it, so it no longer describes the form, and the
        // safe action is to rebuild rather than to reuse.
        await db.query(
          "UPDATE handoff_sessions SET state='completed',completed_at=$1 WHERE owner_id=$2 AND id=$3",
          ["2026-09-28T09:20:00.000Z", owner, handoffId],
        );
        await expect(
          submissions.begin(task, {
            packetId: packet.manifest.id,
            preparationId: preparation.id,
            expectedRevision: Number(app?.revision),
          }),
        ).rejects.toMatchObject({
          code: "FORM_CHANGED",
          message: expect.stringContaining("rebuilt after a challenge handoff"),
        });
        // An early completion must not block a freshly inspected form until the
        // handoff's original future expiry. Keep the session as durable evidence.
        await db.query(
          "UPDATE handoff_sessions SET completed_at=$1,expires_at=$2 WHERE owner_id=$3 AND id=$4",
          ["2026-09-28T08:59:00.000Z", "2026-09-28T09:10:00.000Z", owner, handoffId],
        );
        const handle = await submissions.begin(task, {
          packetId: packet.manifest.id,
          preparationId: preparation.id,
          expectedRevision: Number(app?.revision),
        });
        await submissions.authorizeDispatch(task, handle);
        const externalReceiptId = "00000000-0000-4000-8000-000000000456";
        const evidence = {
          kind: "greenhouse" as const,
          receiptId: externalReceiptId,
          board: "synthetic-board",
          postingId: "123456",
          jobId: packet.manifest.jobId,
          receiptUrl: `https://job-boards.greenhouse.io/synthetic-board/jobs/123456?receipt=${externalReceiptId}`,
          receivedAt: clock().toISOString(),
          emailHash: createHash("sha256").update(packet.content.cv.identity.email).digest("hex"),
        };
        await expect(
          submissions.confirmGreenhouseReceipt(task, handle, {
            ...evidence,
            postingId: "654321",
          }),
        ).rejects.toMatchObject({ code: "RECEIPT_UNCORRELATED" });
        const receiptId = await submissions.confirmReceipt(task, handle, evidence);
        expect(receiptId).toBeTruthy();
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "CONFIRMED" }]);
        expect(
          await db.query("SELECT evidence FROM receipts WHERE owner_id=$1 AND id=$2", [
            owner,
            receiptId,
          ]),
        ).toEqual([{ evidence: JSON.stringify(evidence) }]);
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
        await approveMockScreening(clock);
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

      it.each(["mock", "gmail"] as const)(
        "reconciles an accepted but ambiguous attempt using %s without a second final action",
        async (receiptKind) => {
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
            payload: {
              schemaVersion: 1,
              packetId: packet.manifest.id,
              preparationId: preparation.id,
              expectedRevision: Number(
                (
                  await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
                    owner,
                    packet.manifest.applicationId,
                  ])
                )[0]?.revision,
              ),
            },
          });
          const task = await queue.claim("synthetic-worker", ["submit"]);
          if (!task) throw new Error("Expected a leased submit task.");
          const app = (
            await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
              owner,
              packet.manifest.applicationId,
            ])
          )[0];
          await approveMockScreening(clock);
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
          let evidence: ReceiptEvidence = {
            kind: "mock_ats" as const,
            recordId,
            jobId: packet.manifest.jobId,
            receiptUrl: `http://127.0.0.1:4320/receipts/${recordId}`,
            receivedAt: clock().toISOString(),
            emailHash: createHash("sha256").update(packet.content.cv.identity.email).digest("hex"),
          };
          expect(await submissions.reconcileMockReceipt(reconcile, null)).toBe("needs_review");
          await queue.complete(reconcile);
          const exceptions = new ExceptionRepository(db, owner, clock);
          const exceptionId = await exceptions.record({
            applicationId: packet.manifest.applicationId,
            blocker: "needs_review",
            code: "COMMIT_UNKNOWN",
            reason: "Synthetic lost response needs reconciliation.",
          });
          if (receiptKind === "gmail") {
            const email = new EmailRepository(
              db,
              owner,
              Buffer.alloc(32, 23).toString("base64"),
              clock,
            );
            const mailbox = packet.content.cv.identity.email;
            await email.configure(
              { clientId: "synthetic-client-id", clientSecret: "synthetic-client-secret" },
              mailbox,
              false,
            );
            await email.connected(await email.lease("connecting"), {
              accessToken: "synthetic-access-token",
              refreshToken: "synthetic-refresh-token",
              mailbox,
              expiresAt: "2026-09-17T10:00:00.000Z",
              refreshExpiresAt: null,
            });
            // The loopback employer is a test fixture; public sender approval remains HTTPS-only.
            await db.query(
              "INSERT INTO email_sender_rules(owner_id,employer_origin,sender_domain,approved_at) VALUES($1,$2,$3,$4)",
              [
                owner,
                new URL(packet.content.job.url).origin,
                "mail.synthetic.example",
                clock().toISOString(),
              ],
            );
            const lease = await email.lease("connected");
            const message = {
              id: "synthetic-receipt-message",
              receivedAt: clock().toISOString(),
              sender: "jobs@mail.synthetic.example",
              recipients: [mailbox],
              authenticatedDomain: "mail.synthetic.example",
              subject: `Application received ${documentJob.requisitionId}`,
              text: `Thank you for applying. ${documentJob.requisitionId}`,
            };
            const first = await email.ingest(lease, message);
            expect(first).toBeTruthy();
            expect(await email.ingest(lease, message)).toBe(first);
            const racing = await queue.claim("synthetic-racing-reconciler", ["reconcile"]);
            if (!racing) throw new Error("Expected the first email reconciliation task.");
            // The earlier worker read no mail before delivery, and completes after ingestion.
            expect(await submissions.reconcileWithoutReceipt(racing)).toBe("needs_review");
            expect(await email.ingest(lease, message)).toBe(first);
            await queue.complete(racing);
            expect(await email.ingest(lease, message)).toBe(first);
            expect(
              await db.query("SELECT message_id FROM email_outcome_events WHERE owner_id=$1", [
                owner,
              ]),
            ).toHaveLength(1);
            const receipt = await email.receipt(packet.manifest.applicationId);
            if (!receipt) throw new Error("Expected a correlated synthetic email receipt.");
            evidence = receipt;
            expect(
              JSON.stringify(
                await db.query("SELECT * FROM email_messages WHERE owner_id=$1", [owner]),
              ),
            ).not.toContain("Thank you for applying");
            await email.finishSync(lease);
          }
          const requested = await exceptions.resolve(exceptionId, { action: "reconcile" });
          expect(requested.exception.state).toBe("open");
          expect(requested.requeued).toBe(receiptKind === "gmail" ? 0 : 1);
          expect((await exceptions.resolve(exceptionId, { action: "reconcile" })).requeued).toBe(0);
          const retryReconcile = await queue.claim("synthetic-reconciler", ["reconcile"]);
          if (!retryReconcile) throw new Error("Expected an owner-requested reconciliation task.");
          if (evidence.kind === "gmail") {
            await expect(
              submissions.reconcileReceipt(retryReconcile, {
                ...evidence,
                messageSha256: "0".repeat(64),
              }),
            ).rejects.toMatchObject({ code: "RECEIPT_UNCORRELATED" });
            await expect(
              submissions.confirmReceipt(retryReconcile, handle, evidence),
            ).rejects.toMatchObject({ code: "STATE_INVALID" });
          }
          expect(await submissions.reconcileReceipt(retryReconcile, evidence)).toBe("confirmed");
          await queue.complete(retryReconcile);
          expect((await exceptions.get(exceptionId)).state).toBe("resolved");
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
        },
      );

      it("records a definitive mock validation rejection without a receipt", async () => {
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
        await approveMockScreening(clock);
        const submissions = new SubmissionRepository(db, owner, clock);
        const handle = await submissions.begin(task, {
          packetId: packet.manifest.id,
          preparationId: preparation.id,
          expectedRevision: Number(app?.revision),
        });
        await submissions.authorizeDispatch(task, handle);
        await submissions.recordDefinitiveMockRejection(task, handle);
        await queue.complete(task);
        expect(
          await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "DEFINITIVE_FAILURE" }]);
        expect(
          await db.query("SELECT state FROM attempts WHERE owner_id=$1 AND application_id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([{ state: "DEFINITIVE_FAILURE" }]);
        expect(
          await db.query("SELECT id FROM receipts WHERE owner_id=$1 AND application_id=$2", [
            owner,
            packet.manifest.applicationId,
          ]),
        ).toEqual([]);
      });
    },
  );
}
