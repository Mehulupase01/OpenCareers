import { DomainError } from "../../contracts/src/index.js";
import {
  modelCatalogueSchema,
  type RoutePolicy,
  routePolicySchema,
} from "../../contracts/src/matching.js";
import { assertNoTools, modelReasons } from "./policy.js";
import { assertReviewedEndpoint, type PrivacyRevision, providerPrivacy } from "./privacy.js";
import type { CompletionRequest } from "./transport.js";

export async function verifyRequestRoute(
  request: CompletionRequest,
  policyInput: RoutePolicy,
  revision: PrivacyRevision,
  evidence: { catalogue(): Promise<unknown>; endpoints(model: string): Promise<unknown> },
) {
  const policy = routePolicySchema.parse(policyInput);
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
  if (matches.length !== 1 || !model || modelReasons(model, policy).length)
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Fresh catalogue does not prove an eligible free route.",
    );
  if (revision === "reviewed-career-facts-v1")
    assertReviewedEndpoint(await evidence.endpoints(request.model), request.model, provider);
}
