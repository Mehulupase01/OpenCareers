import type { RoutePolicy } from "../../packages/contracts/src/matching.js";

export const syntheticRoutePolicy = (model: string, provider: string): RoutePolicy => ({
  modelAllowlist: [model],
  providerAllowlist: [provider],
  minimumContext: 8192,
  catalogueMaxAgeSeconds: 21600,
  dailyLimit: 50,
});
export const syntheticCatalogue = (model: string) => ({
  data: [
    {
      id: model,
      context_length: 32768,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["structured_outputs"],
      pricing: { prompt: "0", completion: "0" },
    },
  ],
});
