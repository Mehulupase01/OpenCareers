import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idSchema } from "../../../packages/contracts/src/index.js";
import { outcomeInputSchema } from "../../../packages/contracts/src/outcome.js";
import { CalibrationRepository } from "../../../packages/persistence/src/calibration-repository.js";
import { CohortRepository } from "../../../packages/persistence/src/cohort-repository.js";
import { ExperimentRepository } from "../../../packages/persistence/src/experiment-repository.js";
import { OutcomeRepository } from "../../../packages/persistence/src/outcome-repository.js";
import { RegressionRepository } from "../../../packages/persistence/src/regression-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

export async function outcomeRoutes(app: FastifyInstance, repository: Repository) {
  const outcomes = new OutcomeRepository(repository.db, repository.ownerId);
  const calibration = new CalibrationRepository(repository.db, repository.ownerId);
  const cohorts = new CohortRepository(repository.db, repository.ownerId);
  const experiments = new ExperimentRepository(repository.db, repository.ownerId);
  const regressions = new RegressionRepository(repository.db, repository.ownerId);
  app.get("/v1/outcomes/regressions", () => regressions.list());
  app.post("/v1/outcomes/regressions/:id/review", (request) =>
    regressions.review(z.object({ id: z.uuid() }).parse(request.params).id, request.body),
  );
  app.get("/v1/outcomes/regressions/:id/export", async (request, reply) =>
    reply
      .type("application/json")
      .header("Content-Disposition", 'attachment; filename="reviewed-regression.json"')
      .send(
        `${JSON.stringify(await regressions.export(z.object({ id: z.uuid() }).parse(request.params).id), null, 2)}\n`,
      ),
  );
  app.get("/v1/outcomes/experiments/packets", () => experiments.packets());
  app.get("/v1/outcomes/experiments", () => experiments.list());
  app.post("/v1/outcomes/experiments", (request) => experiments.create(request.body));
  app.post("/v1/outcomes/experiments/:id/stop", (request) =>
    experiments.stop(z.object({ id: z.uuid() }).parse(request.params).id, request.body),
  );
  app.get("/v1/outcomes/experiments/:id/assignments", (request) =>
    experiments.assignments(z.object({ id: z.uuid() }).parse(request.params).id),
  );
  app.post("/v1/outcomes/experiments/assignments", (request) => experiments.assign(request.body));
  app.get("/v1/outcomes/cohorts", () => cohorts.list());
  app.post("/v1/outcomes/cohorts", (request) => cohorts.record(request.body));
  app.get("/v1/outcomes/cohorts/:id", (request) =>
    cohorts.report(z.object({ id: z.uuid() }).parse(request.params).id),
  );
  app.post("/v1/outcomes/cohorts/compare", (request) => cohorts.compare(request.body));
  app.get("/v1/outcomes/calibration/datasets", () => calibration.list());
  app.post("/v1/outcomes/calibration/datasets", (request) => calibration.record(request.body));
  app.get("/v1/outcomes/calibration/datasets/:id", (request) =>
    calibration.report(z.object({ id: z.uuid() }).parse(request.params).id),
  );
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
