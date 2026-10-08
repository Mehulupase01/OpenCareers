import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Repository } from "../../../packages/persistence/src/repository.js";
import {
  RestoreRepository,
  restoreGapReviewSchema,
} from "../../../packages/persistence/src/restore-repository.js";

export async function restoreRoutes(app: FastifyInstance, repository: Repository) {
  const restores = new RestoreRepository(repository.db, repository.ownerId);
  const actor = `owner:${repository.ownerId}`;
  const params = z.object({ runId: z.uuid() }).strict();
  app.get("/v1/restores", () => restores.status());
  app.post("/v1/restores/:runId/applications/:applicationId/review", async (request) => {
    const path = params.extend({ applicationId: z.uuid() }).parse(request.params);
    const body = z
      .object({
        disposition: z.enum(["quarantined", "receipt"]),
        receiptId: z.uuid().optional(),
        note: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(request.body);
    await restores.review(path.runId, path.applicationId, body, actor);
    return { status: "reviewed" };
  });
  app.post("/v1/restores/:runId/release", async (request) => {
    const path = params.parse(request.params);
    const gap = restoreGapReviewSchema.parse(request.body);
    return restores.release(path.runId, actor, gap);
  });
}
