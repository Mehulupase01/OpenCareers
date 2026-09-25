import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prepareMockPacket } from "../../../packages/browser/src/prepare.js";
import type { Config } from "../../../packages/config/src/index.js";
import { DomainError, idSchema } from "../../../packages/contracts/src/index.js";
import { ArtifactStore } from "../../../packages/documents/src/artifact-store.js";
import { BrowserRepository } from "../../../packages/persistence/src/browser-repository.js";
import { DocumentRepository } from "../../../packages/persistence/src/document-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

const dryRunInput = z
  .object({
    packetId: idSchema,
    approvedValues: z.record(
      z.string().min(1).max(120),
      z.union([z.string().max(2000), z.boolean()]),
    ),
    fixture: z
      .enum([
        "standard",
        "upload-fail",
        "resume-overwrite",
        "conditional",
        "challenge",
        "changed-question",
        "misleading-banner",
        "disabled-submit",
        "implicit-submit",
      ])
      .default("standard"),
  })
  .strict();

export async function browserRoutes(app: FastifyInstance, config: Config, repository: Repository) {
  const browser = new BrowserRepository(repository.db, repository.ownerId);
  const documents = new DocumentRepository(repository.db, repository.ownerId);
  const store = new ArtifactStore(config.dataDir);
  await store.initialize();
  app.get("/v1/browser", () => browser.snapshot());
  app.post("/v1/browser/dry-run", async (request) => {
    if (config.profile !== "demo")
      throw new DomainError("NOT_FOUND", "Mock ATS dry runs are available in demo mode only.");
    const input = dryRunInput.parse(request.body);
    const packet = (await documents.snapshot()).find((item) => item.manifest.id === input.packetId);
    if (!packet?.valid) throw new DomainError("NOT_FOUND", "A valid packet is required.");
    const cv = await documents.artifact(packet.manifest.id, "cv_pdf", store);
    const result = await prepareMockPacket(packet, cv.buffer, input.approvedValues, input.fixture);
    return browser.save(result);
  });
}
