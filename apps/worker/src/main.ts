import "../../../packages/config/src/env.js";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { loadConfig } from "../../../packages/config/src/index.js";
import { runDiscovery } from "../../../packages/discovery/src/runner.js";
import { MatchingRunner } from "../../../packages/inference/src/gateway.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { CandidateRepository } from "../../../packages/persistence/src/candidate-repository.js";
import { DiscoveryRepository } from "../../../packages/persistence/src/discovery-repository.js";
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
const matching = new MatchingRunner(
  new MatchingRepository(repository.db, repository.ownerId),
  config,
);
const workerId = `scheduler-${randomUUID().slice(0, 8)}`;
try {
  while (!controller.signal.aborted) {
    await repository.heartbeat(workerId, "scheduler");
    const task =
      config.profile === "demo" ? await repository.claim(workerId, ["demo_probe"]) : null;
    if (task) {
      await repository.complete(task);
      logger.info({ taskId: task.id, fence: task.fence }, "Synthetic queue probe completed");
    }
    await runDiscovery(discovery, config.profile);
    await matching.run();
    await setTimeout(2000, undefined, { signal: controller.signal }).catch(() => undefined);
  }
} catch (error) {
  logger.error({ err: error }, "Worker stopped after storage failure");
  process.exitCode = 1;
} finally {
  await repository.db.close();
}
