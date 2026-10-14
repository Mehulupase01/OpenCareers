import { z } from "zod";
import { experimentGenerationTaskSchema } from "../../../packages/contracts/src/experiment-generation.js";
import { DomainError, errorCodeSchema, type Task } from "../../../packages/contracts/src/index.js";
import type { ArtifactStorage } from "../../../packages/documents/src/artifact-store.js";
import { generatePacketContent } from "../../../packages/documents/src/domain.js";
import { buildPacket } from "../../../packages/documents/src/factory.js";
import type { LetterDraftRunner } from "../../../packages/documents/src/letter-gateway.js";
import type { ExperimentGenerationRepository } from "../../../packages/persistence/src/experiment-generation-repository.js";

const limitsSchema = z
  .object({
    requests: z.number().int().min(2).max(3),
    tokens: z.number().int().min(1).max(8000),
    wallTimeMs: z.number().int().min(1).max(120000),
  })
  .strict();

export async function runVariantPreparation(
  task: Task,
  deps: {
    repository: ExperimentGenerationRepository;
    artifacts: ArtifactStorage;
    runner: Pick<LetterDraftRunner, "draftWithCritique"> | null;
    signal?: AbortSignal;
    limits?: { requests: number; tokens: number; wallTimeMs: number };
  },
) {
  const { repository, artifacts, runner, signal } = deps;
  const generationId =
    typeof task.payload.generationId === "string" ? task.payload.generationId : "";
  try {
    const payload = experimentGenerationTaskSchema.safeParse(task.payload);
    if (!payload.success)
      throw new DomainError("CONFIG_INVALID", "Experiment generation payload is invalid.");
    const begun = await repository.begin(task, payload.data.generationId);
    if (begun.packet) {
      await repository.queueInspection(begun.packet);
      return begun.packet;
    }
    if (!runner)
      throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Reviewed letter route is unavailable.");
    const limits = limitsSchema.safeParse(
      deps.limits ?? { requests: 3, tokens: 8000, wallTimeMs: 120000 },
    );
    if (!limits.success)
      throw new DomainError("CONFIG_INVALID", "Experiment generation limits are invalid.");
    signal?.throwIfAborted();
    const check = () => repository.assertCurrent(task, payload.data.generationId);
    await check();
    const draft = await runner.draftWithCritique(
      begun.input,
      generatePacketContent(begun.input),
      limits.data,
      { recipe: begun.recipe, ...(signal ? { signal } : {}), check },
    );
    signal?.throwIfAborted();
    const built = await buildPacket(artifacts, begun.input, {
      ...draft,
      generationId: payload.data.generationId,
    });
    signal?.throwIfAborted();
    const packet = await repository.publish(task, payload.data.generationId, built, {
      critiqueHash: draft.critiqueHash,
      repaired: draft.repaired,
    });
    await repository.queueInspection(packet);
    return packet;
  } catch (error) {
    const parsedCode = errorCodeSchema.safeParse(error instanceof DomainError ? error.code : null);
    // Failure recording can lose its lease too; preserve the original failure.
    await repository
      .failGeneration(
        task,
        generationId,
        parsedCode.success ? parsedCode.data : "MODEL_ROUTE_INELIGIBLE",
      )
      .catch(() => undefined);
    throw error;
  }
}
