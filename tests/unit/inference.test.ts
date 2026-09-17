import { describe, expect, it } from "vitest";
import type { MatchingInput } from "../../packages/contracts/src/matching.js";
import { buildRequest, parseStructured } from "../../packages/inference/src/gateway.js";
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
});
