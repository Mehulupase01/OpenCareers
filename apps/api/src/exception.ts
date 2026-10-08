import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  type ExceptionResolved,
  exceptionResolveInputSchema,
  type OwnerException,
} from "../../../packages/contracts/src/exception.js";
import { DomainError, idSchema } from "../../../packages/contracts/src/index.js";
import { ExceptionRepository } from "../../../packages/persistence/src/exception-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

export async function exceptionRoutes(app: FastifyInstance, repository: Repository) {
  const exceptions = new ExceptionRepository(repository.db, repository.ownerId);

  app.get("/v1/exceptions", () => exceptions.inbox());
  app.get<{ Params: { id: string } }>("/v1/exceptions/:id", async (request) =>
    exceptions.get(request.params.id),
  );
  app.get<{ Params: { id: string } }>("/v1/exceptions/:id/history", async (request) => ({
    id: request.params.id,
    actions: await exceptions.history(request.params.id),
  }));
  app.post<{ Params: { id: string } }>("/v1/exceptions/:id/resolve", async (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const input = exceptionResolveInputSchema.parse(request.body);
    const result: ExceptionResolved = await exceptions.resolve(id, input);
    return result;
  });
  app.post<{ Params: { id: string } }>("/v1/exceptions/:id/rebuild", async (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const exception = await exceptions.get(id);
    if (!exception.applicationId)
      throw new DomainError("STATE_INVALID", "This task exception has no application form.");
    return exceptions.rebuild(exception.applicationId);
  });
}

export type { OwnerException };
