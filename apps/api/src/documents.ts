import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../../packages/config/src/index.js";
import { packetGenerateInputSchema } from "../../../packages/contracts/src/documents.js";
import { idSchema } from "../../../packages/contracts/src/index.js";
import { ArtifactStore } from "../../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../../packages/documents/src/factory.js";
import { DocumentRepository } from "../../../packages/persistence/src/document-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

const artifactKind = z.enum(["cv_docx", "cv_pdf", "letter_docx", "letter_pdf", "answers_json"]);

export async function documentRoutes(app: FastifyInstance, config: Config, repository: Repository) {
  const documents = new DocumentRepository(repository.db, repository.ownerId);
  const store = new ArtifactStore(config.dataDir);
  await store.initialize();

  app.get("/v1/documents", () => documents.snapshot());
  app.post("/v1/documents/generate", async (request) => {
    const input = packetGenerateInputSchema.parse(request.body);
    const generation = await documents.generationInput(
      input.applicationId,
      input.assessmentId,
      input.requestedAnswers,
      input.asOf,
    );
    return documents.savePacket(await buildPacket(store, generation));
  });
  app.get("/v1/documents/:id/artifacts/:kind", async (request, reply) => {
    const params = z.object({ id: idSchema, kind: artifactKind }).strict().parse(request.params);
    const query = z
      .object({ preview: z.literal("1").optional() })
      .strict()
      .parse(request.query);
    const artifact = await documents.artifact(params.id, params.kind, store);
    return reply
      .type(artifact.mimeType)
      .header(
        "Content-Disposition",
        `${query.preview ? "inline" : "attachment"}; filename="${artifact.filename}"`,
      )
      .header("Content-Length", String(artifact.buffer.length))
      .send(artifact.buffer);
  });
}
