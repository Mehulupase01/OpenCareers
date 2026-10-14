import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runVariantPreparation } from "../../apps/worker/src/variant-preparation.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { DomainError, type Task } from "../../packages/contracts/src/index.js";
import type { LetterVariantRecipe } from "../../packages/contracts/src/letter-variant.js";
import type { ArtifactStorage } from "../../packages/documents/src/artifact-store.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import type { LetterDraftRunner } from "../../packages/documents/src/letter-gateway.js";
import { letterVariantRecipes } from "../../packages/documents/src/letter-variants.js";
import type { ExperimentGenerationRepository } from "../../packages/persistence/src/experiment-generation-repository.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

const generationId = "a7e581a0-4a8f-4b16-8e44-b24aa91602e6";
const catalogRecipe = letterVariantRecipes().find((item) => item.id === "concise");
if (!catalogRecipe) throw new Error("Missing public concise recipe.");
const recipe: LetterVariantRecipe = {
  id: catalogRecipe.id,
  version: catalogRecipe.version,
  sha256: catalogRecipe.sha256,
};
const task: Task = {
  id: "task-generation",
  ownerId: "synthetic-owner",
  applicationId: "application-documents",
  type: "prepare",
  domain: "documents",
  state: "leased",
  payload: { schemaVersion: 1, generationId, assessmentId: "assessment-documents" },
  fence: 1,
  attempts: 1,
  maxAttempts: 3,
  runAfter: "2026-09-17T09:00:00.000Z",
  leaseUntil: "2026-09-17T09:05:00.000Z",
  leaseOwner: "synthetic-worker",
  lastError: null,
};

function memoryArtifacts(): ArtifactStorage {
  const buffers = new Map<string, Buffer>();
  return {
    initialize: async () => undefined,
    storageKey: (sha256) => `sha256/${sha256.slice(0, 2)}/${sha256}`,
    put: vi.fn(async (buffer: Buffer) => {
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const storageKey = `sha256/${sha256.slice(0, 2)}/${sha256}`;
      buffers.set(storageKey, Buffer.from(buffer));
      return { sha256, storageKey, bytes: buffer.length };
    }),
    read: async (key) => {
      const buffer = buffers.get(key);
      if (!buffer) throw new Error("Missing synthetic artifact.");
      return buffer;
    },
  };
}

let retained: PacketSnapshot;
function generationInput() {
  const input = documentGenerationInput();
  return {
    ...input,
    requestedAnswers: input.requestedAnswers.filter(
      (question) => question.semanticKey === "right_to_work",
    ),
  };
}

beforeAll(async () => {
  retained = {
    ...(await buildPacket(memoryArtifacts(), generationInput())),
    valid: true,
    invalidReason: null,
  };
});

function harness() {
  const input = generationInput();
  const repository = {
    begin: vi.fn<ExperimentGenerationRepository["begin"]>(async () => ({
      input,
      recipe,
      packet: null,
    })),
    assertCurrent: vi.fn<ExperimentGenerationRepository["assertCurrent"]>(async () => undefined),
    publish: vi.fn<ExperimentGenerationRepository["publish"]>(async (_task, _id, built) => ({
      ...built,
      valid: true,
      invalidReason: null,
    })),
    failGeneration: vi.fn<ExperimentGenerationRepository["failGeneration"]>(async () => undefined),
    queueInspection: vi.fn<ExperimentGenerationRepository["queueInspection"]>(
      async () => undefined,
    ),
  };
  // This is a synthetic runner result, not evidence of an actual model request.
  const draftWithCritique = vi.fn<LetterDraftRunner["draftWithCritique"]>(async () => ({
    letter: generatePacketContent(input).letter,
    modelId: "synthetic-model:free",
    provider: "synthetic-provider",
    responseHash: "d".repeat(64),
    critiqueHash: "e".repeat(64),
    repaired: true,
    recipe,
    validation: retained.manifest.validation,
  }));
  const deps = {
    repository: repository as unknown as ExperimentGenerationRepository,
    artifacts: memoryArtifacts(),
    runner: { draftWithCritique },
    signal: new AbortController().signal,
  };
  return { input, repository, draftWithCritique, deps };
}

describe("worker experiment variant preparation", () => {
  it("requeues a retained packet without requiring a model route or writing artifacts", async () => {
    const h = harness();
    h.repository.begin.mockResolvedValue({ input: null, recipe, packet: retained });
    expect(await runVariantPreparation(task, { ...h.deps, runner: null })).toBe(retained);
    expect(h.repository.queueInspection).toHaveBeenCalledExactlyOnceWith(retained);
    expect(h.draftWithCritique).not.toHaveBeenCalled();
    expect(h.deps.artifacts.put).not.toHaveBeenCalled();
    expect(h.repository.publish).not.toHaveBeenCalled();
  });

  it("fails closed when the mandatory reviewed route is absent", async () => {
    const h = harness();
    await expect(runVariantPreparation(task, { ...h.deps, runner: null })).rejects.toMatchObject({
      code: "MODEL_ROUTE_INELIGIBLE",
    });
    expect(h.repository.failGeneration).toHaveBeenCalledExactlyOnceWith(
      task,
      generationId,
      "MODEL_ROUTE_INELIGIBLE",
    );
    expect(h.repository.publish).not.toHaveBeenCalled();
    expect(h.repository.queueInspection).not.toHaveBeenCalled();
    expect(h.deps.artifacts.put).not.toHaveBeenCalled();
  });

  it("checks current authorization before invoking the runner", async () => {
    const h = harness();
    const revoked = new DomainError("POLICY_REVOKED", "Synthetic revocation.");
    h.repository.assertCurrent.mockRejectedValue(revoked);
    await expect(runVariantPreparation(task, h.deps)).rejects.toBe(revoked);
    expect(h.draftWithCritique).not.toHaveBeenCalled();
    expect(h.repository.failGeneration).toHaveBeenCalledExactlyOnceWith(
      task,
      generationId,
      "POLICY_REVOKED",
    );
    expect(h.repository.queueInspection).not.toHaveBeenCalled();
  });

  it("passes recipe, signal, per-request guard and bounded defaults, then publishes actual artifacts", async () => {
    const h = harness();
    const packet = await runVariantPreparation(task, h.deps);
    expect(h.repository.begin).toHaveBeenCalledExactlyOnceWith(task, generationId);
    expect(h.draftWithCritique).toHaveBeenCalledExactlyOnceWith(
      h.input,
      generatePacketContent(h.input),
      { requests: 3, tokens: 8000, wallTimeMs: 120000 },
      { recipe, signal: h.deps.signal, check: expect.any(Function) },
    );
    const options = h.draftWithCritique.mock.calls[0]?.[3];
    const revoked = new DomainError("POLICY_REVOKED", "Revoked between requests.");
    h.repository.assertCurrent.mockRejectedValue(revoked);
    await expect(options?.check?.()).rejects.toBe(revoked);
    expect(h.repository.publish).toHaveBeenCalledExactlyOnceWith(
      task,
      generationId,
      { content: packet.content, manifest: packet.manifest },
      { critiqueHash: "e".repeat(64), repaired: true },
    );
    expect(h.deps.artifacts.put).toHaveBeenCalledTimes(5);
    expect(packet.manifest.letterGeneration).toMatchObject({
      method: "llm",
      modelId: "synthetic-model:free",
      provider: "synthetic-provider",
      recipe,
    });
    expect(packet.manifest.validation.status).toBe("valid");
    expect(h.repository.queueInspection).toHaveBeenCalledExactlyOnceWith(packet);
    expect(h.repository.failGeneration).not.toHaveBeenCalled();
  });

  it("does not queue inspection when fenced publication fails", async () => {
    const h = harness();
    const stale = new DomainError("LEASE_STALE", "Synthetic fence rejected.");
    h.repository.publish.mockRejectedValue(stale);
    await expect(runVariantPreparation(task, h.deps)).rejects.toBe(stale);
    expect(h.repository.queueInspection).not.toHaveBeenCalled();
    expect(h.repository.failGeneration).toHaveBeenCalledExactlyOnceWith(
      task,
      generationId,
      "LEASE_STALE",
    );
  });

  it.each([
    [new Error("Sensitive synthetic transport detail."), "MODEL_ROUTE_INELIGIBLE"],
    [
      new DomainError("CLAIM_UNSUPPORTED", "Sensitive synthetic claim detail."),
      "CLAIM_UNSUPPORTED",
    ],
    [
      new DomainError("untrusted-code" as never, "Synthetic malformed code."),
      "MODEL_ROUTE_INELIGIBLE",
    ],
  ])(
    "records only sanitized codes and preserves the original error even if failure recording loses its lease",
    async (error, code) => {
      const h = harness();
      h.draftWithCritique.mockRejectedValue(error);
      h.repository.failGeneration.mockRejectedValue(
        new DomainError("LEASE_STALE", "Synthetic stale lease."),
      );
      await expect(runVariantPreparation(task, h.deps)).rejects.toBe(error);
      expect(h.repository.failGeneration).toHaveBeenCalledExactlyOnceWith(task, generationId, code);
      expect(h.repository.publish).not.toHaveBeenCalled();
      expect(h.repository.queueInspection).not.toHaveBeenCalled();
      expect(h.deps.artifacts.put).not.toHaveBeenCalled();
    },
  );

  it("does not redraft after begin rejects an interrupted generation", async () => {
    const h = harness();
    const interrupted = new DomainError("STATE_INVALID", "Synthetic drafting was interrupted.");
    h.repository.begin.mockRejectedValue(interrupted);
    await expect(runVariantPreparation(task, h.deps)).rejects.toBe(interrupted);
    expect(h.draftWithCritique).not.toHaveBeenCalled();
    expect(h.repository.publish).not.toHaveBeenCalled();
  });

  it("rejects extra payload fields before beginning generation", async () => {
    const h = harness();
    await expect(
      runVariantPreparation({ ...task, payload: { ...task.payload, extra: true } }, h.deps),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(h.repository.begin).not.toHaveBeenCalled();
    expect(h.draftWithCritique).not.toHaveBeenCalled();
  });

  it("passes smaller valid review limits unchanged", async () => {
    const h = harness();
    const limits = { requests: 2, tokens: 4000, wallTimeMs: 60000 };
    await runVariantPreparation(task, { ...h.deps, limits });
    expect(h.draftWithCritique.mock.calls[0]?.[2]).toEqual(limits);
  });

  it.each([
    { requests: 4, tokens: 8000, wallTimeMs: 120000 },
    { requests: 1, tokens: 8000, wallTimeMs: 120000 },
    { requests: 3, tokens: 8001, wallTimeMs: 120000 },
    { requests: 3, tokens: 8000, wallTimeMs: 120001 },
    { requests: 3, tokens: 0, wallTimeMs: 120000 },
    { requests: 3, tokens: 8000, wallTimeMs: Number.NaN },
  ])("rejects invalid review limits before inference: %j", async (limits) => {
    const h = harness();
    await expect(runVariantPreparation(task, { ...h.deps, limits })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    expect(h.draftWithCritique).not.toHaveBeenCalled();
    expect(h.repository.failGeneration).toHaveBeenCalledExactlyOnceWith(
      task,
      generationId,
      "CONFIG_INVALID",
    );
  });

  it("honors cancellation before inference", async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runVariantPreparation(task, { ...h.deps, signal: controller.signal }),
    ).rejects.toThrow();
    expect(h.draftWithCritique).not.toHaveBeenCalled();
    expect(h.repository.publish).not.toHaveBeenCalled();
  });
});
