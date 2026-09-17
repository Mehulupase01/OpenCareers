import type { CatalogueModel, RouteDecision, RoutePolicy } from "../../contracts/src/matching.js";
import { modelCatalogueSchema, routePolicySchema } from "../../contracts/src/matching.js";

const knownPrices = new Set([
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
]);

export function modelReasons(model: CatalogueModel, policy: RoutePolicy): string[] {
  const reasons: string[] = [];
  if (!policy.modelAllowlist.includes(model.id)) reasons.push("Model is not allowlisted.");
  if (!model.id.endsWith(":free")) reasons.push("Model is not an explicit free variant.");
  const keys = Object.keys(model.pricing);
  if (!keys.includes("prompt") || !keys.includes("completion"))
    reasons.push("Prompt and completion prices must be explicit.");
  for (const [dimension, raw] of Object.entries(model.pricing)) {
    if (dimension === "overrides") {
      reasons.push("Tiered price overrides are not eligible.");
      continue;
    }
    if (!knownPrices.has(dimension)) {
      reasons.push(`Unknown price dimension: ${dimension}.`);
      continue;
    }
    if ((typeof raw !== "string" && typeof raw !== "number") || !Number.isFinite(Number(raw))) {
      reasons.push(`Unknown ${dimension} price.`);
      continue;
    }
    if (Number(raw) !== 0) reasons.push(`${dimension} price is not zero.`);
  }
  if (!(model.architecture.input_modalities ?? []).includes("text"))
    reasons.push("Text input is unsupported.");
  if (!(model.architecture.output_modalities ?? []).includes("text"))
    reasons.push("Text output is unsupported.");
  if (
    !model.supported_parameters.includes("structured_outputs") ||
    !model.supported_parameters.includes("response_format")
  )
    reasons.push("Strict structured output is unsupported.");
  if ((model.context_length ?? 0) < policy.minimumContext)
    reasons.push("Context capacity is below policy.");
  return [...new Set(reasons)];
}

export function selectRoute(
  rawCatalogue: unknown,
  rawPolicy: RoutePolicy,
  catalogueFetchedAt: string,
  now = new Date(),
): RouteDecision {
  const catalogue = modelCatalogueSchema.parse(rawCatalogue);
  const policy = routePolicySchema.parse(rawPolicy);
  const age = now.getTime() - Date.parse(catalogueFetchedAt);
  if (!Number.isFinite(age) || age < 0 || age > policy.catalogueMaxAgeSeconds * 1000)
    return {
      eligible: false,
      modelId: "",
      provider: null,
      reasons: ["Model catalogue evidence is missing, future-dated or expired."],
      catalogueFetchedAt,
    };
  const candidates = policy.modelAllowlist.map((id) => catalogue.data.find((m) => m.id === id));
  for (const model of candidates) {
    if (model && !modelReasons(model, policy).length)
      return {
        eligible: true,
        modelId: model.id,
        provider: policy.providerAllowlist[0] ?? null,
        reasons: [],
        catalogueFetchedAt,
      };
  }
  return {
    eligible: false,
    modelId: "",
    provider: null,
    reasons: candidates.flatMap((model, index) =>
      model
        ? modelReasons(model, policy).map(
            (reason) => `${policy.modelAllowlist[index] ?? "unknown"}: ${reason}`,
          )
        : [`${policy.modelAllowlist[index] ?? "unknown"}: Model is absent from the catalogue.`],
    ),
    catalogueFetchedAt,
  };
}

export function assertNoTools(input: unknown): void {
  if (
    input &&
    typeof input === "object" &&
    ["tools", "tool_choice", "plugins"].some((key) => key in input)
  )
    throw new Error("Tools and paid tool configuration are disabled.");
}
