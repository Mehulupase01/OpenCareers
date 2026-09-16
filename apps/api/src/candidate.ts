import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authorizationText, chronology } from "../../../packages/candidate/src/domain.js";
import { MAX_SOURCE_BYTES } from "../../../packages/candidate/src/extract.js";
import { CandidateImporter } from "../../../packages/candidate/src/import.js";
import type { Config } from "../../../packages/config/src/index.js";
import {
  answerInputSchema,
  factInputSchema,
  policyInputSchema,
} from "../../../packages/contracts/src/candidate.js";
import { DomainError, idSchema } from "../../../packages/contracts/src/index.js";
import { CandidateRepository } from "../../../packages/persistence/src/candidate-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

export async function candidateRoutes(
  app: FastifyInstance,
  config: Config,
  repository: Repository,
) {
  const candidates = new CandidateRepository(repository.db, repository.ownerId);
  await candidates.initialize();
  const importer = new CandidateImporter(candidates, config.dataDir);
  await app.register(multipart, {
    limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_SOURCE_BYTES },
  });
  app.get("/v1/candidate", async () => {
    const snapshot = await candidates.snapshot();
    return {
      ...snapshot,
      chronology: chronology(snapshot.facts, new Date().toISOString().slice(0, 10)),
    };
  });
  app.post("/v1/candidate/sources", { bodyLimit: MAX_SOURCE_BYTES + 65536 }, async (request) => {
    const file = await request.file();
    if (!file) throw new DomainError("CONFIG_INVALID", "Choose one PDF or DOCX file.");
    return importer.import(await file.toBuffer(), file.filename);
  });
  app.get("/v1/candidate/sources/:id", (request) =>
    candidates.source(z.object({ id: idSchema }).parse(request.params).id),
  );
  app.post("/v1/candidate/facts", (request) =>
    candidates.saveFact(factInputSchema.parse(request.body)),
  );
  app.post("/v1/candidate/facts/:id/review", (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const { expectedRevision, status } = z
      .object({
        expectedRevision: z.number().int().positive(),
        status: z.enum(["verified", "conflicting", "expired"]),
      })
      .strict()
      .parse(request.body);
    return candidates.reviewFact(id, expectedRevision, status);
  });
  app.post("/v1/candidate/profile", (request) =>
    candidates.publishProfile(
      z
        .object({ expectedRevision: z.number().int().min(0) })
        .strict()
        .parse(request.body).expectedRevision,
    ),
  );
  app.post("/v1/candidate/answers", (request) =>
    candidates.saveAnswer(answerInputSchema.parse(request.body)),
  );
  app.post("/v1/candidate/authorization", (request) =>
    candidates.saveAuthorization(policyInputSchema.parse(request.body)),
  );
  app.post("/v1/candidate/authorization/:id/revoke", async (request) => {
    await candidates.revokeAuthorization(z.object({ id: idSchema }).parse(request.params).id);
    return { status: "revoked" };
  });
  app.get("/v1/candidate/authorization/export", async (_request, reply) => {
    const policy = (await candidates.snapshot()).authorization;
    if (!policy) throw new DomainError("NOT_FOUND", "No authorization has been recorded.");
    return reply
      .type("text/plain; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="opencareers-authorization.txt"')
      .send(authorizationText(policy));
  });
}
