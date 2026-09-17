import type { FastifyInstance } from "fastify";
import type { Config } from "../../../packages/config/src/index.js";
import { idSchema } from "../../../packages/contracts/src/index.js";
import { MatchingRunner } from "../../../packages/inference/src/gateway.js";
import { MatchingRepository } from "../../../packages/persistence/src/matching-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

export async function matchingRoutes(app: FastifyInstance, config: Config, repository: Repository) {
  const matching = new MatchingRepository(repository.db, repository.ownerId);
  const runner = new MatchingRunner(matching, config);

  app.get("/v1/matching", () => matching.snapshot(config.inference.dailyLimit));
  app.post("/v1/matching/jobs/:id/assess", (request) =>
    runner.assessNow(idSchema.parse((request.params as { id?: unknown }).id)),
  );
}
