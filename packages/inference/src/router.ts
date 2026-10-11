import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";
import {
  modelCatalogueSchema,
  type RoutePolicy,
  routePolicySchema,
} from "../../contracts/src/matching.js";
import { completionContextBound } from "./limits.js";
import { assertNoTools, modelReasons, selectRoute } from "./policy.js";
import { assertReviewedEndpoint, type PrivacyRevision, providerPrivacy } from "./privacy.js";
import type { CompletionRequest } from "./transport.js";

const sampleSchema = z
  .object({
    modelId: z.string().max(240),
    provider: z.string().max(120),
    accepted: z.boolean(),
    latencyMs: z.number().int().min(0).max(600000),
    observedAt: z.iso.datetime(),
  })
  .strict();
export function selectMeasuredRoute(
  catalogue: unknown,
  policyInput: RoutePolicy,
  fetchedAt: string,
  samplesInput: z.infer<typeof sampleSchema>[],
  revision: PrivacyRevision = "strict-zdr-v1",
  now = new Date(),
) {
  const policy = routePolicySchema.parse(policyInput);
  const samples = z
    .array(sampleSchema)
    .max(2000)
    .parse(samplesInput)
    .filter((sample) => {
      const age = now.getTime() - Date.parse(sample.observedAt);
      return age >= 0 && age <= 30 * 86400000;
    });
  const candidates = [];
  for (const modelId of policy.modelAllowlist)
    for (const provider of policy.providerAllowlist) {
      const decision = selectRoute(
        catalogue,
        { ...policy, modelAllowlist: [modelId], providerAllowlist: [provider] },
        fetchedAt,
        now,
      );
      if (!decision.eligible) continue;
      try {
        providerPrivacy(modelId, provider, revision, now);
      } catch {
        continue;
      }
      const history = samples
        .filter((sample) => sample.modelId === modelId && sample.provider === provider)
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
        .slice(0, 100);
      const recent = history.slice(0, 3);
      const blocked =
        recent.length === 3 &&
        recent.every((sample) => !sample.accepted) &&
        now.getTime() - Date.parse(recent[0]?.observedAt ?? "") < 15 * 60000;
      if (blocked) continue;
      const latencies = history.map((sample) => sample.latencyMs).sort((a, b) => a - b);
      candidates.push({
        decision,
        samples: history.length,
        acceptance:
          history.filter((sample) => sample.accepted).length / Math.max(1, history.length),
        latency: latencies[Math.floor(latencies.length / 2)] ?? 600000,
      });
    }
  // Do not rank sparse observations as proven task quality; retain owner ordering.
  if (candidates.length && candidates.every((candidate) => candidate.samples >= 5))
    candidates.sort((a, b) => b.acceptance - a.acceptance || a.latency - b.latency);
  const chosen = candidates[0];
  return (
    chosen?.decision ?? {
      ...selectRoute(catalogue, policy, fetchedAt, now),
      eligible: false,
      modelId: "",
      provider: null,
      reasons: ["No healthy privacy-compatible eligible free route is available."],
    }
  );
}

export async function verifyRequestRoute(
  request: CompletionRequest,
  policyInput: RoutePolicy,
  revision: PrivacyRevision,
  evidence: { catalogue(): Promise<unknown>; endpoints(model: string): Promise<unknown> },
) {
  const policy = routePolicySchema.parse(policyInput);
  if (
    !Number.isSafeInteger(request.max_tokens) ||
    request.max_tokens < 1 ||
    request.max_tokens > 8000
  )
    throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Completion output allowance is invalid.");
  const contextPolicy = {
    ...policy,
    minimumContext: Math.max(
      policy.minimumContext,
      completionContextBound(request) + request.max_tokens,
    ),
  };
  assertNoTools(request);
  const provider = request.provider.only[0] ?? "";
  if (
    !policy.modelAllowlist.includes(request.model) ||
    !policy.providerAllowlist.includes(provider) ||
    JSON.stringify(request.provider) !==
      JSON.stringify(providerPrivacy(request.model, provider, revision))
  )
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Request route or privacy controls are not allowlisted.",
    );
  const catalogue = modelCatalogueSchema.parse(await evidence.catalogue());
  const matches = catalogue.data.filter((model) => model.id === request.model);
  const model = matches[0];
  if (matches.length !== 1 || !model || modelReasons(model, contextPolicy).length)
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Fresh catalogue does not prove an eligible free route.",
    );
  if (revision === "reviewed-career-facts-v1")
    assertReviewedEndpoint(await evidence.endpoints(request.model), request.model, provider);
}
