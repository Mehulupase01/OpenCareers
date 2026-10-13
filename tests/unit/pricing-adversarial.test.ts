import { afterEach, expect, it, vi } from "vitest";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { buildLetterRequest } from "../../packages/documents/src/letter-draft.js";
import { buildRequest } from "../../packages/inference/src/gateway.js";
import { explicitZeroPrice, modelReasons } from "../../packages/inference/src/policy.js";
import {
  assertReviewedEndpoint,
  reviewedCareerPolicy,
} from "../../packages/inference/src/privacy.js";
import { OpenRouterTransport } from "../../packages/inference/src/transport.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";
import { matchingEvaluationCases } from "../fixtures/matching-evaluation.js";
import { syntheticCatalogue, syntheticRoutePolicy } from "../helpers/route-fixtures.js";

afterEach(() => vi.useRealTimers());
const model = "synthetic/model:free";
const provider = "synthetic-provider";
const policy = syntheticRoutePolicy(model, provider);
const nonzero = [
  0,
  -0,
  "1e-9999",
  "0.0000000000000000001e-9999",
  "0001.000e-10000",
  "1e-324",
  "1e-999999999999999999999999",
  "0.01",
  "1e309",
  "-0.01",
  " 0 ",
  "0x0",
  "",
  null,
  false,
  {},
  NaN,
  Infinity,
];

it.each(nonzero)("never treats nonzero or uninterpretable price %j as free", (raw) => {
  expect(explicitZeroPrice(raw)).toBe(false);
  const candidate = syntheticCatalogue(model).data[0];
  if (!candidate) throw new Error("Missing synthetic model");
  for (const dimension of [
    "prompt",
    "completion",
    "image",
    "audio",
    "web_search",
    "internal_reasoning",
    "input_cache_read",
    "input_cache_write",
    "input_cache_write_1h",
    "input_audio_cache",
    "image_output",
    "audio_output",
  ])
    expect(
      modelReasons({ ...candidate, pricing: { ...candidate.pricing, [dimension]: raw } }, policy)
        .length,
    ).toBeGreaterThan(0);
});
it.each(["0", "00", "0.00000", "0e-9999", "000.000E+123"])(
  "accepts only an explicit zero decimal coefficient %j",
  (raw) => {
    expect(explicitZeroPrice(raw)).toBe(true);
  },
);

it("refuses numeric prices whose positive coefficient was lost during JSON decoding", () => {
  const pricing = JSON.parse('{"prompt":1e-9999,"completion":"0"}');
  expect(pricing.prompt).toBe(0);
  const candidate = syntheticCatalogue(model).data[0];
  if (!candidate) throw new Error("Missing synthetic model");
  expect(modelReasons({ ...candidate, pricing }, policy).length).toBeGreaterThan(0);
});

it("blocks endpoint-level underflow, numeric coercions, tiering and unknown dimensions", () => {
  const reviewed = reviewedCareerPolicy.models[0];
  const base = {
    model_id: reviewed,
    provider_name: "Novita",
    tag: "novita/bf16",
    status: 0,
    context_length: 262144,
    supported_parameters: ["structured_outputs", "response_format"],
    pricing: { prompt: "0", completion: "0" },
  };
  for (const raw of nonzero)
    expect(() =>
      assertReviewedEndpoint(
        { data: { endpoints: [{ ...base, pricing: { ...base.pricing, completion: raw } }] } },
        reviewed,
        "novita",
      ),
    ).toThrow("explicit free");
  for (const pricing of [
    { prompt: "0" },
    { ...base.pricing, overrides: [] },
    { ...base.pricing, unknown_dimension: "0" },
  ])
    expect(() =>
      assertReviewedEndpoint({ data: { endpoints: [{ ...base, pricing }] } }, reviewed, "novita"),
    ).toThrow("explicit free");
});

it("revalidates matching and mandatory-letter prices at each POST without falling back", async () => {
  const matching = matchingEvaluationCases[0]?.input;
  if (!matching) throw new Error("Missing matching fixture");
  const input = documentGenerationInput();
  for (const request of [
    buildRequest(matching, model, provider),
    buildLetterRequest(input, generatePacketContent(input), model, provider),
  ]) {
    let catalogues = 0,
      posts = 0;
    const transport = new OpenRouterTransport(
      "synthetic-not-a-real-key",
      async (url) => {
        if (String(url).endsWith("/models")) {
          const catalogue = syntheticCatalogue(model);
          const candidate = catalogue.data[0];
          if (!candidate) throw new Error("Missing synthetic model");
          if (++catalogues > 1) candidate.pricing.prompt = "1e-9999";
          return Response.json(catalogue);
        }
        posts++;
        return Response.json({
          model,
          provider,
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        });
      },
      "strict-zdr-v1",
      policy,
    );
    await transport.complete(request);
    await expect(transport.complete(request)).rejects.toMatchObject({
      code: "MODEL_ROUTE_INELIGIBLE",
    });
    expect(catalogues).toBe(2);
    expect(posts).toBe(1);
  }
});
