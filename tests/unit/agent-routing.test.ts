import { describe, expect, it, vi } from "vitest";
import { buildRequest } from "../../packages/inference/src/gateway.js";
import { selectMeasuredRoute, verifyRequestRoute } from "../../packages/inference/src/router.js";
import { OpenRouterTransport } from "../../packages/inference/src/transport.js";
import { matchingEvaluationCases } from "../fixtures/matching-evaluation.js";
import { syntheticCatalogue, syntheticRoutePolicy } from "../helpers/route-fixtures.js";

const model = "synthetic/model:free";
const policy = syntheticRoutePolicy(model, "synthetic-provider");
const request = () => {
  const fixture = matchingEvaluationCases[0];
  if (!fixture) throw new Error("Missing synthetic matching fixture.");
  return buildRequest(fixture.input, model, "synthetic-provider");
};
describe("Per-call free route revalidation", () => {
  it.each([
    { prompt: "0.01", completion: "0" },
    { prompt: "", completion: "0" },
    { prompt: "0x0", completion: "0" },
    { prompt: "0", completion: "0", overrides: [] },
    { prompt: "0", completion: "0", unknown_dimension: "0" },
  ])("rejects changed or uninterpretable catalogue prices %j", async (pricing) => {
    const catalogue = syntheticCatalogue(model);
    const candidate = catalogue.data[0];
    if (!candidate) throw new Error("Missing synthetic model.");
    Object.assign(candidate, { pricing });
    await expect(
      verifyRequestRoute(request(), policy, "strict-zdr-v1", {
        catalogue: async () => catalogue,
        endpoints: async () => null,
      }),
    ).rejects.toMatchObject({ code: "MODEL_ROUTE_INELIGIBLE" });
  });
  it("rejects manual paid pins, provider fallbacks and paid tools before catalogue access", async () => {
    const evidence = {
      catalogue: vi.fn(async () => syntheticCatalogue(model)),
      endpoints: vi.fn(),
    };
    for (const changed of [
      { ...request(), model: "synthetic/paid" },
      { ...request(), provider: { ...request().provider, allow_fallbacks: true } },
      { ...request(), tools: [] },
    ])
      await expect(
        verifyRequestRoute(
          changed as ReturnType<typeof request>,
          policy,
          "strict-zdr-v1",
          evidence,
        ),
      ).rejects.toThrow();
    expect(evidence.catalogue).not.toHaveBeenCalled();
  });
  it("rechecks a ready model before every POST and blocks repricing without fallback", async () => {
    let catalogues = 0;
    let posts = 0;
    const transport = new OpenRouterTransport(
      "synthetic-key",
      async (url) => {
        if (String(url).endsWith("/models")) {
          const catalogue = syntheticCatalogue(model);
          const candidate = catalogue.data[0];
          if (!candidate) throw new Error("Missing synthetic model.");
          if (++catalogues > 1) candidate.pricing.prompt = "0.01";
          return Response.json(catalogue);
        }
        posts++;
        return Response.json({
          model,
          provider: "synthetic-provider",
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        });
      },
      "strict-zdr-v1",
      policy,
    );
    await transport.complete(request());
    await expect(transport.complete(request())).rejects.toMatchObject({
      code: "MODEL_ROUTE_INELIGIBLE",
    });
    expect(catalogues).toBe(2);
    expect(posts).toBe(1);
  });
  it("requires policy even when a hand-crafted free request looks valid", async () => {
    const fetcher = vi.fn();
    await expect(
      new OpenRouterTransport("synthetic-key", fetcher).complete(request()),
    ).rejects.toThrow("explicit route policy");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Measured route selection remains subordinate to policy", () => {
  const now = new Date("2026-10-11T00:00:00.000Z");
  const alternate = "synthetic/alternate:free";
  const catalogue = {
    data: [...syntheticCatalogue(model).data, ...syntheticCatalogue(alternate).data],
  };
  const expanded = { ...policy, modelAllowlist: [model, alternate] };
  const samples = (modelId: string, accepted: boolean[], latencyMs = 1000) =>
    accepted.map((value) => ({
      modelId,
      provider: "synthetic-provider",
      accepted: value,
      latencyMs,
      observedAt: now.toISOString(),
    }));
  const choose = (
    history: ReturnType<typeof samples>,
    raw: unknown = catalogue,
    options = expanded,
    at = now,
  ) => selectMeasuredRoute(raw, options, now.toISOString(), history, "strict-zdr-v1", at);
  it("prefers measured validator acceptance, then latency only with adequate evidence", () => {
    expect(
      choose([
        ...samples(model, [true, true, true, true, false], 10),
        ...samples(alternate, [true, true, true, true, true], 100),
      ]).modelId,
    ).toBe(alternate);
    expect(
      choose([
        ...samples(model, [true, true, true, true, true], 1000),
        ...samples(alternate, [true, true, true, true, true], 100),
      ]).modelId,
    ).toBe(alternate);
    expect(
      choose([...samples(model, [true, true, true, true, true]), ...samples(alternate, [true], 10)])
        .modelId,
    ).toBe(model);
  });
  it("temporarily excludes three recent failures without changing provider or price rules", () => {
    const failures = samples(model, [false, false, false]);
    expect(choose(failures).modelId).toBe(alternate);
    expect(
      choose(failures, catalogue, expanded, new Date(now.getTime() + 15 * 60000)).modelId,
    ).toBe(model);
    expect(choose([...failures, ...samples(alternate, [false, false, false])]).eligible).toBe(
      false,
    );
  });
  it("discards stale and future samples instead of pretending they are measured quality", () => {
    for (const observedAt of ["2026-01-01T00:00:00.000Z", "2026-10-12T00:00:00.000Z"]) {
      const history = [
        ...samples(model, [true, true, true, true, true]),
        ...samples(alternate, [true, true, true, true, true], 10).map((sample) => ({
          ...sample,
          observedAt,
        })),
      ];
      expect(choose(history).modelId).toBe(model);
    }
  });
  it("cannot rank a repriced model ahead of an eligible route or override a manual allowlist", () => {
    const changed = structuredClone(catalogue);
    const candidate = changed.data.find((entry) => entry.id === alternate);
    if (!candidate) throw new Error("Missing synthetic alternate.");
    candidate.pricing.prompt = "0.01";
    const history = [
      ...samples(model, [true, true, true, true, false]),
      ...samples(alternate, [true, true, true, true, true], 10),
    ];
    expect(choose(history, changed).modelId).toBe(model);
    expect(choose(history, catalogue, policy).modelId).toBe(model);
  });
  it("filters context-ineligible routes even when their measured acceptance is higher", () => {
    const changed = structuredClone(catalogue);
    const candidate = changed.data.find((entry) => entry.id === alternate);
    if (!candidate) throw new Error("Missing synthetic alternate.");
    candidate.context_length = 65536;
    expect(choose([], changed, { ...expanded, minimumContext: 40000 }).modelId).toBe(alternate);
  });
});
