import { describe, expect, it, vi } from "vitest";
import { draftWorkerLetter } from "../../apps/worker/src/preparation.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

describe("worker mandatory LLM letter policy", () => {
  it("selects the ordinary LLM by default and requires explicit review opt-in", async () => {
    const config = { ...loadConfig({}), profile: "local" as const };
    const runner = { draft: vi.fn(), draftWithCritique: vi.fn() };
    await draftWorkerLetter(config, documentGenerationInput(), runner);
    expect(runner.draft).toHaveBeenCalledOnce();
    expect(runner.draftWithCritique).not.toHaveBeenCalled();
    await draftWorkerLetter(
      { ...config, inference: { ...config.inference, letterReviewEnabled: true } },
      documentGenerationInput(),
      runner,
    );
    expect(runner.draftWithCritique).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), {
      requests: 3,
      tokens: 8000,
      wallTimeMs: 120000,
    });
  });
  it("never falls back to a template after missing or failed private inference", async () => {
    const config = { ...loadConfig({}), profile: "local" as const };
    await expect(draftWorkerLetter(config, documentGenerationInput(), null)).rejects.toMatchObject({
      code: "MODEL_ROUTE_INELIGIBLE",
    });
    const runner = {
      draft: vi.fn(async () => {
        throw new Error("Synthetic inference failure.");
      }),
      draftWithCritique: vi.fn(),
    };
    await expect(draftWorkerLetter(config, documentGenerationInput(), runner)).rejects.toThrow(
      "Synthetic inference failure",
    );
    expect(runner.draftWithCritique).not.toHaveBeenCalled();
    expect(
      await draftWorkerLetter(loadConfig({}), documentGenerationInput(), null),
    ).toBeUndefined();
  });
});
