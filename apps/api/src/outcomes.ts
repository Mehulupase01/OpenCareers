import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idSchema } from "../../../packages/contracts/src/index.js";
import { outcomeInputSchema } from "../../../packages/contracts/src/outcome.js";
import { OutcomeRepository } from "../../../packages/persistence/src/outcome-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

export async function outcomeRoutes(app: FastifyInstance, repository: Repository) {
  const outcomes = new OutcomeRepository(repository.db, repository.ownerId);
  app.get("/v1/outcomes/:applicationId", (request) =>
    outcomes.history(z.object({ applicationId: idSchema }).parse(request.params).applicationId),
  );
  app.post("/v1/outcomes", (request) =>
    outcomes.recordOwner(outcomeInputSchema.parse(request.body)),
  );
  app.post("/v1/outcomes/reverse", (request) => {
    const input = z
      .object({
        applicationId: idSchema,
        eventId: idSchema,
        expectedRevision: z.number().int().nonnegative(),
        requestId: z.uuid(),
      })
      .strict()
      .parse(request.body);
    return outcomes.reverse(
      input.applicationId,
      input.eventId,
      input.expectedRevision,
      input.requestId,
    );
  });
  app.post("/v1/outcomes/mail", (request) =>
    outcomes.recordMail(z.object({ messageId: idSchema }).strict().parse(request.body).messageId),
  );
  app.post("/v1/outcomes/cohort", (request) => outcomes.cohort(request.body));
}
