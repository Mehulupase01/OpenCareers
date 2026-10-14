import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createAdapterRegistry } from "../packages/browser/src/adapter-sdk.js";
import type { FormAnswerGuard } from "../packages/browser/src/answer-guard.js";
import { DomainError, type JobInput } from "../packages/contracts/src/index.js";
import { ArtifactStore } from "../packages/documents/src/artifact-store.js";
import { buildPacket } from "../packages/documents/src/factory.js";
import { localDay } from "../packages/domain/src/state.js";
import { type MockApplication, startMockAts } from "../packages/mock-ats/src/server.js";
import { BrowserRepository } from "../packages/persistence/src/browser-repository.js";
import { CandidateRepository } from "../packages/persistence/src/candidate-repository.js";
import { DocumentRepository } from "../packages/persistence/src/document-repository.js";
import type { Repository } from "../packages/persistence/src/repository.js";
import { SubmissionRepository } from "../packages/persistence/src/submission-repository.js";
import {
  documentAssessment,
  documentAuthorization,
  documentFacts,
  documentJob,
  documentProfile,
} from "../tests/fixtures/document-packets.js";

export const capacityScenarios = [
  "standard",
  "challenge",
  "upload-fail",
  "changed-question",
  "response-loss",
  "validation-reject",
  "rejected-fit",
  "model-latency",
  "account-blocked",
] as const;
export type CapacityScenario = (typeof capacityScenarios)[number];
export const commitCrashBoundaries = [
  "claimed_before_intent",
  "intent_before_dispatch",
  "authorized_without_click",
  "accepted_before_receipt",
  "receipt_write_failed",
  "receipt_before_task_complete",
] as const;
export type CommitCrashBoundary = (typeof commitCrashBoundaries)[number];
const definitions = [
  { semanticKey: "country", meaning: "Country", answer: "NL", evidenceFactIds: ["fact-work-nl"] },
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

export async function createCapacityFixture(
  repository: Repository,
  directory: string,
  hooks: {
    afterAcceptedResponseLoss?: () => Promise<never>;
    afterCommitBoundary?: (boundary: CommitCrashBoundary) => Promise<void>;
    interruptAfterAuthorization?: boolean;
    failReceiptWrite?: boolean;
  } = {},
) {
  const physical = await realpath(directory);
  const canonical = resolve(directory);
  if (
    (process.platform === "win32"
      ? physical.toLowerCase() !== canonical.toLowerCase()
      : physical !== canonical) ||
    !basename(directory).startsWith("opencareers-capacity-") ||
    repository.ownerId !== "synthetic-owner" ||
    repository.db.dialect !== "sqlite" ||
    (await readFile(join(directory, ".synthetic-workspace"), "utf8")).trim() !==
      "OpenCareers synthetic data v1"
  )
    throw new Error("Capacity fixtures require fresh isolated synthetic storage.");
  for (const table of [
    "jobs",
    "applications",
    "profile_versions",
    "authorizations",
    "attempts",
    "candidate_sources",
    "fact_versions",
    "approved_answers",
  ])
    if (
      Number(
        (
          await repository.db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=$1`, [
            repository.ownerId,
          ])
        )[0]?.count ?? 0,
      )
    )
      throw new Error("Capacity fixtures refuse an existing application corpus.");
  const now = new Date();
  const until = new Date(now.getTime() + 7 * 86400000).toISOString();
  const policy = {
    ...documentAuthorization,
    dailyLimit: 50,
    effectiveAt: new Date(now.getTime() - 60000).toISOString(),
    expiresAt: until,
  };
  const candidates = new CandidateRepository(repository.db, repository.ownerId);
  await candidates.initialize();
  const tx = repository.db;
  const owner = repository.ownerId;
  await tx.query("UPDATE candidates SET id=$1 WHERE owner_id=$2", [
    documentProfile.candidateId,
    owner,
  ]);
  for (const fact of documentFacts) {
    await tx.query(
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
    await tx.query("INSERT INTO fact_heads(owner_id,id,revision) VALUES($1,$2,$3)", [
      owner,
      fact.id,
      fact.revision,
    ]);
  }
  await tx.query(
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
  await tx.query(
    "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      policy.id,
      owner,
      policy.revision,
      JSON.stringify(policy),
      policy.effectiveAt,
      policy.expiresAt,
    ],
  );
  await tx.query(
    "UPDATE candidates SET id=$1,active_profile_id=$2,active_authorization_id=$3 WHERE owner_id=$4",
    [documentProfile.candidateId, documentProfile.id, policy.id, owner],
  );
  await repository.setControl({ submissionsPaused: false });
  for (const definition of definitions)
    await candidates.saveAnswer({
      ...definition,
      validFrom: localDay(now),
      validUntil: localDay(new Date(until)),
      employerIds: [documentJob.employerId],
      countries: ["NL"],
    });
  const artifacts = new ArtifactStore(directory);
  await artifacts.initialize();
  const documents = new DocumentRepository(tx, owner);
  const browser = new BrowserRepository(tx, owner);
  const submissions = new SubmissionRepository(tx, owner);
  const adapter = createAdapterRegistry(directory).get("mock-ats");

  return async (scenario: CapacityScenario) => {
    const started = performance.now();
    const at = new Date().toISOString();
    const id = randomUUID();
    const job: JobInput = {
      ...documentJob,
      id: `capacity-${id}`,
      requisitionId: id,
      url: `https://jobs.synthetic.example/capacity/${id}`,
    };
    await repository.putJob(job);
    const application = await repository.createApplication(job.id, documentProfile.candidateId);
    const assessment = {
      ...documentAssessment,
      id: `assessment-${id}`,
      jobId: job.id,
      applicationId: application.id,
      createdAt: at,
    };
    const stageMs = {
      fixtureAssessment: performance.now() - started,
      packet: 0,
      preparation: 0,
      commit: 0,
      reconciliation: 0,
      simulatedModelDelay: 0,
    };
    const expected: Record<CapacityScenario, string> = {
      standard: "confirmed",
      challenge: "challenge",
      "upload-fail": "upload_failed",
      "changed-question": "needs_input",
      "response-loss": "reconciled_confirmed",
      "validation-reject": "definitive_failure",
      "rejected-fit": "fixture_rejected_fit",
      "model-latency": "confirmed",
      "account-blocked": "fixture_account_blocked",
    };
    const finish = async (outcome: string) => {
      if (outcome !== expected[scenario])
        throw new Error(`Unexpected synthetic outcome for ${scenario}: ${outcome}`);
      const mock = await startMockAts(join(directory, "mock-ats-records"));
      try {
        const records = (await mock.app.inject({ url: "/__test/records" })).json<{
          records: MockApplication[];
        }>().records;
        const accepted = records.filter((record) => record.jobId === job.id).length;
        const shouldAccept = outcome === "confirmed" || outcome === "reconciled_confirmed";
        if (accepted !== (shouldAccept ? 1 : 0))
          throw new Error("Synthetic server record count does not match the measured outcome.");
      } finally {
        await mock.app.close();
      }
      const attempts = Number(
        (
          await tx.query(
            "SELECT COUNT(*) AS count FROM attempts WHERE owner_id=$1 AND application_id=$2",
            [owner, application.id],
          )
        )[0]?.count ?? 0,
      );
      if (attempts > 1) throw new Error("Synthetic workload created a duplicate commit attempt.");
      return { scenario, outcome, stageMs, elapsedMs: performance.now() - started };
    };
    if (scenario === "rejected-fit") {
      await repository.transition(application.id, application.revision, "NORMALIZED");
      const row = (
        await tx.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
          owner,
          application.id,
        ])
      )[0];
      await repository.transition(application.id, Number(row?.revision), "SKIPPED");
      return finish("fixture_rejected_fit");
    }
    // Reviewed synthetic assessment replay, not measured live matching/model quality.
    await tx.query(
      "UPDATE applications SET state='ELIGIBLE',revision=revision+1 WHERE owner_id=$1 AND id=$2",
      [owner, application.id],
    );
    const data = JSON.stringify(assessment);
    await tx.query(
      "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,application_id,revision,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)",
      [
        owner,
        assessment.id,
        job.id,
        documentProfile.id,
        application.id,
        data,
        createHash("sha256").update(data).digest("hex"),
        at,
      ],
    );
    if (scenario === "account-blocked") {
      await repository.enqueue({
        type: "prepare",
        applicationId: application.id,
        domain: "mock-ats",
        dedupeKey: `friction:${id}`,
        maxAttempts: 2,
      });
      const task = await repository.claim("capacity-worker", ["prepare"]);
      if (!task) throw new Error("Expected synthetic account-friction task.");
      await repository.fail(
        task,
        new DomainError("SESSION_EXPIRED", "Synthetic account friction."),
      );
      return finish("fixture_account_blocked");
    }
    if (scenario === "model-latency") {
      const delayStarted = performance.now();
      await setTimeout(250);
      stageMs.simulatedModelDelay = performance.now() - delayStarted;
    }
    const packetStarted = performance.now();
    const input = await documents.generationInput(
      application.id,
      assessment.id,
      [],
      localDay(new Date()),
    );
    const packet = await documents.savePacket(await buildPacket(artifacts, input));
    const fixture = scenario === "model-latency" ? "standard" : scenario;
    const target = adapter.parseTarget({ fixture });
    const cv = await documents.artifact(packet.manifest.id, "cv_pdf", artifacts);
    stageMs.packet = performance.now() - packetStarted;
    const approvedValues = Object.fromEntries(
      definitions.map((item) => [item.semanticKey, item.answer]),
    );
    const validate: FormAnswerGuard = (snapshot, plan) =>
      candidates.validateFormPlan(packet, snapshot, plan);
    const preparationStarted = performance.now();
    const result = await adapter.prepare({
      packet,
      cvPdf: cv.buffer,
      target,
      approvedValues,
      validateAnswers: validate,
    });
    const preparation = await browser.save(result);
    stageMs.preparation = performance.now() - preparationStarted;
    if (result.status !== "ready") return finish(result.status);
    const commitStarted = performance.now();
    await repository.enqueue({
      type: "submit",
      applicationId: application.id,
      domain: "mock-ats",
      dedupeKey: `submit:${id}`,
    });
    const task = await repository.claim("capacity-worker", ["submit"]);
    if (!task) throw new Error("Expected guarded synthetic submit task.");
    await hooks.afterCommitBoundary?.("claimed_before_intent");
    const revision = Number(
      (
        await tx.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
          owner,
          application.id,
        ])
      )[0]?.revision,
    );
    const handle = await submissions.begin(task, {
      packetId: packet.manifest.id,
      preparationId: preparation.id,
      expectedRevision: revision,
    });
    await hooks.afterCommitBoundary?.("intent_before_dispatch");
    let interruptedAfterAuthorization = false,
      writingReceipt = false;
    try {
      const outcome = await adapter.commit({
        packet,
        cvPdf: cv.buffer,
        target,
        preparation,
        authorizeDispatch: async () => {
          const permit = await submissions.authorizeDispatch(task, handle);
          if (hooks.interruptAfterAuthorization) {
            interruptedAfterAuthorization = true;
            throw new DomainError(
              "COMMIT_UNKNOWN",
              "Synthetic interruption before the final click.",
            );
          }
          return permit;
        },
        validateAnswers: (snapshot, plan) =>
          candidates.validateFormPlan(packet, snapshot, plan, {
            attemptId: handle.attemptId,
            fence: handle.fence,
          }),
      });
      if (outcome.status === "confirmed") {
        await hooks.afterCommitBoundary?.("accepted_before_receipt");
        writingReceipt = true;
        await submissions.confirmReceipt(task, handle, outcome.evidence);
        writingReceipt = false;
        await hooks.afterCommitBoundary?.("receipt_before_task_complete");
      } else await submissions.recordDefinitiveRejection(task, handle, outcome.reason);
      await repository.complete(task);
      stageMs.commit = performance.now() - commitStarted;
      return finish(outcome.status);
    } catch (error) {
      if (interruptedAfterAuthorization)
        await hooks.afterCommitBoundary?.("authorized_without_click");
      if (writingReceipt && hooks.failReceiptWrite) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Synthetic receipt storage failure")
        )
          throw error;
        await hooks.afterCommitBoundary?.("receipt_write_failed");
      }
      // Only the declared response-loss scenario may enter read-only reconciliation.
      if (scenario !== "response-loss") throw error;
      const attempt = (
        await tx.query("SELECT dispatch_started_at FROM attempts WHERE owner_id=$1 AND id=$2", [
          owner,
          handle.attemptId,
        ])
      )[0];
      if (!attempt?.dispatch_started_at) throw error;
      await hooks.afterAcceptedResponseLoss?.();
      stageMs.commit = performance.now() - commitStarted;
      const reconcileStarted = performance.now();
      await repository.fail(
        task,
        new DomainError("COMMIT_UNKNOWN", "Synthetic response was lost."),
      );
      const reconcile = await repository.claim("capacity-reconciler", ["reconcile"]);
      if (!reconcile || reconcile.applicationId !== application.id)
        throw new Error("Expected correlated reconciliation task.");
      const evidence = await adapter.reconcile({ packet, target });
      const outcome = await submissions.reconcileReceipt(reconcile, evidence);
      if (outcome !== "confirmed")
        throw new Error("Synthetic response loss was not receipt-confirmed.");
      await repository.complete(reconcile);
      stageMs.reconciliation = performance.now() - reconcileStarted;
      return finish(`reconciled_${outcome}`);
    }
  };
}
