import "../../../packages/config/src/env.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { commitPreparedMockPacket } from "../../../packages/browser/src/commit-mock.js";
import { observeMockReceipt } from "../../../packages/browser/src/observe-mock.js";
import { loadConfig } from "../../../packages/config/src/index.js";
import { DomainError } from "../../../packages/contracts/src/index.js";
import { runDiscovery } from "../../../packages/discovery/src/runner.js";
import { ArtifactStore } from "../../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../../packages/documents/src/factory.js";
import { MatchingRunner } from "../../../packages/inference/src/gateway.js";
import { startMockAts } from "../../../packages/mock-ats/src/server.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { BrowserRepository } from "../../../packages/persistence/src/browser-repository.js";
import { CandidateRepository } from "../../../packages/persistence/src/candidate-repository.js";
import { DiscoveryRepository } from "../../../packages/persistence/src/discovery-repository.js";
import { DocumentRepository } from "../../../packages/persistence/src/document-repository.js";
import { connect } from "../../../packages/persistence/src/index.js";
import { MatchingRepository } from "../../../packages/persistence/src/matching-repository.js";
import { SubmissionRepository } from "../../../packages/persistence/src/submission-repository.js";

const logger = createLogger();
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
const config = loadConfig();
const repository = await connect(config);
await new CandidateRepository(repository.db, repository.ownerId).initialize();
const discovery = new DiscoveryRepository(repository.db, repository.ownerId);
const documents = new DocumentRepository(repository.db, repository.ownerId);
const browser = new BrowserRepository(repository.db, repository.ownerId);
const submissions = new SubmissionRepository(repository.db, repository.ownerId);
const artifacts = new ArtifactStore(config.dataDir);
await artifacts.initialize();
const matching = new MatchingRunner(
  new MatchingRepository(repository.db, repository.ownerId),
  config,
);
const workerId = `scheduler-${randomUUID().slice(0, 8)}`;
try {
  while (!controller.signal.aborted) {
    try {
      await repository.heartbeat(workerId, "scheduler");
      const task = await repository.claim(
        workerId,
        config.profile === "demo" ? ["demo_probe", "prepare", "submit", "reconcile"] : ["prepare"],
      );
      if (task) {
        try {
          if (task.type === "prepare") {
            if (!task.applicationId || typeof task.payload.assessmentId !== "string")
              throw new DomainError("CONFIG_INVALID", "Prepare task payload is incomplete.");
            if (await documents.hasValidPacket(task.payload.assessmentId)) {
              logger.info(
                { taskId: task.id, applicationId: task.applicationId },
                "Existing valid packet retained",
              );
              await repository.complete(task);
              continue;
            }
            const application = (
              await repository.db.query(
                "SELECT revision,state FROM applications WHERE owner_id=$1 AND id=$2",
                [repository.ownerId, task.applicationId],
              )
            )[0];
            if (application?.state === "ELIGIBLE")
              await repository.transition(
                task.applicationId,
                Number(application.revision),
                "PREPARING",
              );
            const input = await documents.generationInput(
              task.applicationId,
              task.payload.assessmentId,
              [],
              new Date().toISOString().slice(0, 10),
            );
            await documents.savePacket(await buildPacket(artifacts, input), {
              preserveValidAssessment: true,
            });
            logger.info({ taskId: task.id, applicationId: task.applicationId }, "Packet prepared");
          }
          if (task.type === "submit") {
            const packetId = task.payload.packetId;
            const preparationId = task.payload.preparationId;
            if (
              !task.applicationId ||
              typeof packetId !== "string" ||
              typeof preparationId !== "string"
            )
              throw new DomainError("CONFIG_INVALID", "Submit task payload is incomplete.");
            const packet = (await documents.snapshot()).find(
              (item) => item.manifest.id === packetId,
            );
            const preparation = (await browser.snapshot()).find(
              (item) => item.id === preparationId,
            );
            if (!packet?.valid || !preparation)
              throw new DomainError("PROFILE_STALE", "Submit task packet or preparation is stale.");
            const cv = await documents.artifact(packetId, "cv_pdf", artifacts);
            const approvedValues = Object.fromEntries(
              preparation.result.plans.flatMap((plan) =>
                plan.entries.map((entry) => [entry.semanticKey, entry.expected]),
              ),
            );
            const mock = await startMockAts(join(config.dataDir, "mock-ats-records"));
            try {
              const app = (
                await repository.db.query(
                  "SELECT revision FROM applications WHERE owner_id=$1 AND id=$2",
                  [repository.ownerId, task.applicationId],
                )
              )[0];
              const handle = await submissions.begin(task, {
                packetId,
                preparationId,
                expectedRevision: Number(app?.revision),
              });
              const evidence = await commitPreparedMockPacket(
                mock,
                packet,
                cv.buffer,
                approvedValues,
                preparation,
                () => submissions.authorizeDispatch(task, handle),
              );
              const receiptId = await submissions.confirmMockReceipt(task, handle, evidence);
              logger.info(
                { taskId: task.id, applicationId: task.applicationId, receiptId },
                "Mock application receipt confirmed",
              );
            } finally {
              await mock.app.close();
            }
          }
          if (task.type === "reconcile") {
            if (!task.applicationId)
              throw new DomainError("CONFIG_INVALID", "Reconcile task has no application.");
            const row = (
              await repository.db.query(
                "SELECT i.packet_id FROM attempts a JOIN intents i ON i.owner_id=a.owner_id AND i.id=a.intent_id WHERE a.owner_id=$1 AND a.application_id=$2 ORDER BY a.started_at DESC,a.id DESC LIMIT 1",
                [repository.ownerId, task.applicationId],
              )
            )[0];
            const packet = (await documents.snapshot()).find(
              (item) => item.manifest.id === row?.packet_id,
            );
            if (!packet) throw new DomainError("NOT_FOUND", "Reconciliation packet is missing.");
            const mock = await startMockAts(join(config.dataDir, "mock-ats-records"));
            try {
              const evidence = await observeMockReceipt(mock, packet);
              const outcome = await submissions.reconcileMockReceipt(task, evidence);
              logger.info({ taskId: task.id, outcome }, "Mock submission reconciled");
            } finally {
              await mock.app.close();
            }
          }
          await repository.complete(task);
          if (task.type === "demo_probe")
            logger.info({ taskId: task.id, fence: task.fence }, "Synthetic queue probe completed");
        } catch (error) {
          const domain =
            error instanceof DomainError
              ? error
              : new DomainError("STORAGE_UNAVAILABLE", "Packet preparation failed.", true);
          await repository.fail(task, domain);
          logger.warn({ err: error, taskId: task.id }, "Worker task failed");
        }
      }
      await runDiscovery(discovery, config.profile);
      await matching.run();
      await setTimeout(2000, undefined, { signal: controller.signal }).catch(() => undefined);
    } catch (error) {
      logger.error({ err: error }, "Worker iteration failed; retrying after backoff");
      await setTimeout(5000, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  }
} finally {
  await repository.db.close();
}
