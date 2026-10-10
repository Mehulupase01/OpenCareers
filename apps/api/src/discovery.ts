import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../../packages/config/src/index.js";
import { sourceInputSchema } from "../../../packages/contracts/src/discovery.js";
import { DomainError, idSchema } from "../../../packages/contracts/src/index.js";
import { sourceSessionInputSchema } from "../../../packages/contracts/src/source-session.js";
import { parseHistory } from "../../../packages/discovery/src/history.js";
import { recognizeUrl } from "../../../packages/discovery/src/normalize.js";
import { CoverageRepository } from "../../../packages/persistence/src/coverage-repository.js";
import { DiscoveryRepository } from "../../../packages/persistence/src/discovery-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";
import { SourceSessionRepository } from "../../../packages/persistence/src/source-session-repository.js";

export async function discoveryRoutes(
  app: FastifyInstance,
  config: Config,
  repository: Repository,
) {
  const discovery = new DiscoveryRepository(repository.db, repository.ownerId);
  const coverage = new CoverageRepository(repository.db, repository.ownerId);
  const sessions = new SourceSessionRepository(repository.db, repository.ownerId, config.vaultKey);
  app.get("/v1/discovery/source-sessions", () => sessions.snapshot());
  app.post("/v1/discovery/source-sessions", async (request) => {
    if (config.profile === "demo")
      throw new DomainError("CONFIG_INVALID", "Private source sessions are unavailable in demo.");
    await sessions.store(sourceSessionInputSchema.parse(request.body));
    return sessions.snapshot();
  });
  app.delete("/v1/discovery/source-sessions/:id", async (request) => {
    const { id } = z
      .object({ id: z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/) })
      .parse(request.params);
    const { expectedRevision } = z
      .object({ expectedRevision: z.number().int().positive() })
      .strict()
      .parse(request.body);
    await sessions.revoke(id, expectedRevision);
    return sessions.snapshot();
  });
  app.get("/v1/discovery/coverage", () => coverage.report());
  app.get("/v1/discovery", (request) => {
    const query = z
      .object({
        offset: z.coerce.number().int().min(0).max(500000).default(0),
        q: z.string().max(240).default(""),
      })
      .strict()
      .parse(request.query);
    return discovery.snapshot(query.offset, query.q);
  });
  app.post("/v1/discovery/sources", (request) => {
    const input = sourceInputSchema.parse(request.body);
    if (config.profile === "demo" && input.mode !== "fixture")
      throw new DomainError("CONFIG_INVALID", "Demo sources must be synthetic fixtures.");
    return discovery.saveSource(input);
  });
  app.post("/v1/discovery/recognize", (request) =>
    recognizeUrl(
      z
        .object({ url: z.url().max(2000) })
        .strict()
        .parse(request.body).url,
    ),
  );
  app.post("/v1/discovery/sources/:id/poll", async (request) => {
    const id = z.object({ id: idSchema }).parse(request.params).id;
    const input = z
      .object({ acknowledgeQuality: z.boolean().default(false) })
      .strict()
      .parse(request.body);
    await discovery.schedule(id, input.acknowledgeQuality);
    return { status: "scheduled" };
  });
  app.get("/v1/discovery/runs/:id", (request) =>
    discovery.evidence(z.object({ id: idSchema }).parse(request.params).id),
  );
  app.post("/v1/discovery/history", { bodyLimit: 2200000 }, async (request) => {
    const input = z
      .object({
        format: z.enum(["json", "csv"]),
        content: z.string().max(2100000),
        preview: z.boolean(),
      })
      .strict()
      .parse(request.body);
    let records: ReturnType<typeof parseHistory>;
    try {
      records = parseHistory(input.content, input.format);
    } catch {
      throw new DomainError(
        "CONFIG_INVALID",
        "History file is invalid. Check required columns, dates and explicit submission assertions.",
      );
    }
    for (const record of records) recognizeUrl(record.url);
    if (input.preview) return { records, count: records.length };
    return discovery.importHistory(records);
  });
  app.post("/v1/discovery/identities", async (request) => {
    const input = z
      .object({ from: idSchema, to: idSchema, reason: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(request.body);
    return { id: await discovery.mergeJobs(input.from, input.to, input.reason) };
  });
  app.post("/v1/discovery/identities/:id/split", async (request) => {
    await discovery.splitJobs(z.object({ id: idSchema }).parse(request.params).id);
    return { status: "split" };
  });
}
