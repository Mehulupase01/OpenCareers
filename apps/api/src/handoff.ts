import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  type HandoffBrokerPort,
  VisibleHandoffBroker,
} from "../../../packages/browser/src/handoff-broker.js";
import { idSchema } from "../../../packages/contracts/src/index.js";
import { HandoffRepository } from "../../../packages/persistence/src/handoff-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

const createInput = z
  .object({
    applicationId: idSchema,
    preparationId: idSchema,
    adapterId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const openInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const completeInput = z.object({ generation: z.number().int().positive() }).strict();

export async function handoffRoutes(
  app: FastifyInstance,
  repository: Repository,
  broker: HandoffBrokerPort = new VisibleHandoffBroker(),
) {
  const handoffs = new HandoffRepository(repository.db, repository.ownerId);
  app.addHook("onClose", () => broker.closeAll());
  app.get("/v1/handoffs", () => handoffs.snapshot());
  app.post("/v1/handoffs", async (request) => {
    const created = await handoffs.create(createInput.parse(request.body));
    return created;
  });
  app.post("/v1/handoffs/:id/open", async (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const { token } = openInput.parse(request.body);
    const leaseOwner = `browser:${randomUUID()}`;
    const session = await handoffs.claimHandoff(id, token, leaseOwner);
    try {
      const target = await handoffs.target(id);
      await broker.open(session, target.result, leaseOwner);
      return session;
    } catch (error) {
      await broker.close(id);
      await handoffs.cancelClaim(id, leaseOwner, session.generation).catch(() => undefined);
      throw error;
    }
  });
  app.post("/v1/handoffs/:id/complete", async (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const { generation } = completeInput.parse(request.body);
    const { leaseOwner } = await broker.verify(id, generation);
    try {
      return await handoffs.completeHandoff(id, leaseOwner, generation);
    } finally {
      await broker.close(id);
    }
  });
}
