import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../packages/config/src/index.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { buildLetterRequest } from "../../packages/documents/src/letter-draft.js";
import { buildRequest } from "../../packages/inference/src/gateway.js";
import {
  assertPrivacyRoute,
  assertReviewedEndpoint,
  careerTextMinimizer,
  privacyBinding,
  providerPrivacy,
  reviewedCareerPolicy,
} from "../../packages/inference/src/privacy.js";
import { OpenRouterTransport } from "../../packages/inference/src/transport.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";
import { matchingEvaluationCases } from "../fixtures/matching-evaluation.js";

const model = reviewedCareerPolicy.models[0];
const revision = "reviewed-career-facts-v1";
const endpoint = {
  model_id: model,
  provider_name: "Novita",
  tag: "novita/bf16",
  status: 0,
  context_length: 262144,
  pricing: { prompt: "0", completion: "0", discount: 0 },
  supported_parameters: ["structured_outputs", "response_format"],
};

describe("explicit reviewed career-facts inference policy", () => {
  beforeEach(() => vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z")));
  afterEach(() => vi.useRealTimers());

  it("keeps strict privacy by default and requires a configured private opt-in", () => {
    expect(loadConfig({}).inference.privacyRevision).toBe("strict-zdr-v1");
    expect(() => loadConfig({ AUTOPILOT_INFERENCE_PRIVACY_REVISION: revision })).toThrow(
      "configured private",
    );
    expect(() =>
      loadConfig({ AUTOPILOT_INFERENCE_PRIVACY_REVISION: "allow-any-provider" }),
    ).toThrow();
    expect(providerPrivacy(model, "novita")).toMatchObject({ data_collection: "deny", zdr: true });
    expect(providerPrivacy(model, "novita", revision)).toMatchObject({
      only: ["novita"],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: "allow",
      zdr: false,
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    });
  });

  it.each([
    [model, "unreviewed", "2026-10-09T12:00:00.000Z"],
    ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia", "2026-10-09T12:00:00.000Z"],
    [model, "novita", "2026-10-08T23:59:59.999Z"],
    [model, "novita", "2026-11-08T00:00:00.000Z"],
  ])("rejects unreviewed or expired route %s %s %s", (id, provider, date) => {
    expect(() => providerPrivacy(id, provider, revision, new Date(date))).toThrow("unreviewed");
  });

  it("requires the exact privacy binding and fresh, nonfuture endpoint evidence", () => {
    const route = {
      modelId: model,
      provider: "novita",
      privacyBinding: privacyBinding(revision),
      lastCatalogueAt: new Date().toISOString(),
    };
    expect(() => assertPrivacyRoute(route, revision)).not.toThrow();
    for (const change of [
      { privacyBinding: "old-review" },
      { lastCatalogueAt: "2026-10-09T06:00:00.000Z" },
      { lastCatalogueAt: "2026-10-10T00:00:00.000Z" },
      { lastCatalogueAt: null },
    ])
      expect(() => assertPrivacyRoute({ ...route, ...change }, revision)).toThrow(
        "current privacy",
      );
  });

  it("requires endpoint-level free prices, capabilities, status and provider identity", () => {
    const evidence = (item: object) => ({ data: { endpoints: [item] } });
    expect(assertReviewedEndpoint(evidence(endpoint), model, "novita")).toEqual(endpoint);
    for (const change of [
      { model_id: "other/model:free" },
      { provider_name: "Other" },
      { tag: "other/bf16" },
      { status: -1 },
      { context_length: 1000 },
      { supported_parameters: ["response_format"] },
      { pricing: { prompt: "0" } },
      { pricing: { prompt: "0", completion: "0.01" } },
      { pricing: { prompt: "", completion: "0" } },
      { pricing: { prompt: "0", completion: "0", request: "0.01" } },
    ])
      expect(() =>
        assertReviewedEndpoint(evidence({ ...endpoint, ...change }), model, "novita"),
      ).toThrow("explicit free");
  });

  it("removes identity/contact/immigration text while preserving vacancy offsets", () => {
    const input = documentGenerationInput();
    const identity = input.profile.facts.find((fact) => fact.value.kind === "identity");
    if (identity?.value.kind !== "identity") throw new Error("Missing synthetic identity.");
    const text = `${identity.value.fullName} ${identity.value.email} ${identity.value.phone}. Visa expires tomorrow. Python https://example.test/contact sk-or-v1-${"x".repeat(30)}`;
    const minimize = careerTextMinimizer(input.profile.facts);
    const safe = minimize(text);
    expect(safe).toHaveLength(text.length);
    expect(safe.indexOf("Python")).toBe(text.indexOf("Python"));
    for (const privateValue of [
      identity.value.fullName,
      identity.value.email,
      "Visa",
      "https://",
      "sk-or-v1-",
    ])
      expect(safe).not.toContain(privateValue);
    expect(minimize(safe)).toBe(safe);
  });

  it("uses the same reviewed controls for matching and mandatory LLM letters", () => {
    const input = structuredClone(matchingEvaluationCases[0]?.input);
    if (!input) throw new Error("Missing fixture.");
    input.job.description += "\nSend resumes to contact@example.test. Work permit details.";
    const request = buildRequest(input, model, "novita", revision);
    expect(request.provider).toEqual(providerPrivacy(model, "novita", revision));
    expect(request.messages[1]?.content).not.toContain("contact@example.test");
    expect(request.messages[1]?.content).not.toContain("Work permit");
    expect(request).not.toHaveProperty("tools");
    const letterInput = documentGenerationInput();
    const letter = buildLetterRequest(
      letterInput,
      generatePacketContent(letterInput),
      model,
      "novita",
      revision,
    );
    expect(letter.provider).toEqual(request.provider);
    const payload = letter.messages[1]?.content ?? "";
    for (const fact of letterInput.profile.facts)
      if (fact.value.kind === "identity") expect(payload).not.toContain(fact.value.fullName);
    expect(letter).not.toHaveProperty("tools");
  });

  it("refuses hand-crafted privacy relaxation before any HTTP request", async () => {
    const input = matchingEvaluationCases[0]?.input;
    if (!input) throw new Error("Missing fixture.");
    const request = buildRequest(input, model, "novita", revision);
    const fetcher = vi.fn(async () => new Response("{}", { status: 404 }));
    const strict = new OpenRouterTransport("synthetic-key", fetcher);
    await expect(strict.complete(request)).rejects.toThrow("privacy controls");
    expect(fetcher).not.toHaveBeenCalled();
    const reviewed = new OpenRouterTransport("synthetic-key", fetcher, revision);
    await expect(
      reviewed.complete({
        ...request,
        provider: { ...request.provider, only: ["novita", "other"] },
      }),
    ).rejects.toThrow("privacy controls");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(reviewed.complete(request)).rejects.toThrow("privacy requirements");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
