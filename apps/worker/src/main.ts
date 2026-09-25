import "../../../packages/config/src/env.js";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { loadConfig } from "../../../packages/config/src/index.js";
import { DomainError } from "../../../packages/contracts/src/index.js";
import { runDiscovery } from "../../../packages/discovery/src/runner.js";
import { ArtifactStore } from "../../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../../packages/documents/src/factory.js";
import { MatchingRunner } from "../../../packages/inference/src/gateway.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { CandidateRepository } from "../../../packages/persistence/src/candidate-repository.js";
import { DiscoveryRepository } from "../../../packages/persistence/src/discovery-repository.js";
import { DocumentRepository } from "../../../packages/persistence/src/document-repository.js";
import { connect } from "../../../packages/persistence/src/index.js";
import { MatchingRepository } from "../../../packages/persistence/src/matching-repository.js";

const logger = createLogger();
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
const config = loadConfig();
const repository = await connect(config);
await new CandidateRepository(repository.db, repository.ownerId).initialize();
const discovery = new DiscoveryRepository(repository.db, repository.ownerId);
const documents = new DocumentRepository(repository.db, repository.ownerId);
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
        config.profile === "demo" ? ["demo_probe", "prepare"] : ["prepare"],
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
