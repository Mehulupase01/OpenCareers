import { describe, expect, it } from "vitest";
import type { MatchingInput } from "../../packages/contracts/src/matching.js";
import {
  buildRequest,
  inferenceFacts,
  parseStructured,
} from "../../packages/inference/src/gateway.js";
import { OpenRouterTransport } from "../../packages/inference/src/transport.js";
import { matchingEvaluationCases } from "../fixtures/matching-evaluation.js";

describe("bounded inference gateway", () => {
  it("minimizes facts and fixes the free provider route without tools", () => {
    const input = matchingEvaluationCases[0]?.input as MatchingInput;
    const request = buildRequest(input, "synthetic/model:free", "synthetic-provider");
    expect(request.provider).toEqual({
      only: ["synthetic-provider"],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
    });
    expect(request).not.toHaveProperty("tools");
    expect(JSON.stringify(request)).not.toContain("apiKey");
    expect(JSON.stringify(request)).not.toContain("identity");
    expect(JSON.stringify(request)).not.toContain("work_authorization");
    expect(JSON.stringify(request)).not.toContain("future sponsorship");
    expect(inferenceFacts(input.facts).map((fact) => fact.value.kind)).toEqual([
      "skill",
      "language",
    ]);
  });

  it("permits one syntax-only envelope repair and rejects invalid output", () => {
    const proposal = {
      requirements: [],
      uncertainty: 1,
      summary: "Synthetic uncertain output.",
    };
    expect(parseStructured(`prefix ${JSON.stringify(proposal)} suffix`)).toEqual(proposal);
    expect(() => parseStructured("not json")).toThrow(/invalid/);
  });

  it("converts 429 responses into a bounded retryable domain error", async () => {
    const transport = new OpenRouterTransport(
      "synthetic-not-a-real-key",
      async () => new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
    );
    await expect(transport.catalogue()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("identifies a missing privacy-compatible endpoint without relaxing the request", async () => {
    const transport = new OpenRouterTransport("synthetic-not-a-real-key", async (_url, init) => {
      expect(JSON.parse(String(init?.body)).provider).toEqual({
        only: ["nvidia"],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      });
      return new Response("{}", { status: 404 });
    });
    const request = buildRequest(
      matchingEvaluationCases[0]?.input as MatchingInput,
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia",
    );
    await expect(transport.complete(request)).rejects.toMatchObject({
      code: "MODEL_ROUTE_INELIGIBLE",
      message: expect.stringContaining("privacy requirements"),
    });
  });

  it("normalizes a case-only provider display difference and rejects another provider", async () => {
    const request = buildRequest(
      matchingEvaluationCases[0]?.input as MatchingInput,
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia",
    );
    const response = (provider: string) =>
      new Response(
        JSON.stringify({
          model: request.model,
          provider,
          choices: [{ message: { content: "{}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    const matching = new OpenRouterTransport("synthetic-key", async () => response("Nvidia"));
    expect((await matching.complete(request)).provider).toBe("nvidia");
    const changed = new OpenRouterTransport("synthetic-key", async () => response("Other"));
    await expect(changed.complete(request)).rejects.toThrow("provider differed");
  });
});
