import { createHash } from "node:crypto";
import { z } from "zod";
import type { CandidateFact } from "../../contracts/src/candidate.js";
import { DomainError } from "../../contracts/src/index.js";

export type PrivacyRevision = "strict-zdr-v1" | "reviewed-career-facts-v1";

export const reviewedCareerPolicy = {
  revision: "reviewed-career-facts-v1",
  reviewedAt: "2026-10-09T00:00:00.000Z",
  expiresAt: "2026-11-08T00:00:00.000Z",
  provider: "novita",
  models: ["apodex/apodex-1.1-mini:free"],
  purposes: ["matching", "letter"],
  sources: [
    {
      url: "https://novita.ai/legal/terms-of-service",
      sha256: "473e1a6953e76766a56623601f0b0ce4e10fbbb60f62b6c46d055132116abba7",
    },
    {
      url: "https://novita.ai/legal/privacy-policy",
      sha256: "51f5f82dbc09bc31b76bef13cc8170b652fd5f404dd705791520985263494a1f",
    },
  ],
  retention:
    "Inference-content retention has service, legal and support exceptions; technical metadata may be retained. Not an unconditional ZDR guarantee.",
  training:
    "Terms section 10.2 excludes inference Content from training or service improvement by default; published privacy policy also excludes personal information from training.",
} as const;

export function privacyBinding(revision: PrivacyRevision = "strict-zdr-v1"): string {
  return revision === "strict-zdr-v1"
    ? revision
    : createHash("sha256").update(JSON.stringify(reviewedCareerPolicy)).digest("hex");
}

export function providerPrivacy(
  model: string,
  provider: string,
  revision: PrivacyRevision = "strict-zdr-v1",
  now = new Date(),
) {
  if (revision !== "strict-zdr-v1" && revision !== "reviewed-career-facts-v1")
    throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Unknown inference privacy revision.");
  if (revision === "reviewed-career-facts-v1") {
    if (
      provider !== reviewedCareerPolicy.provider ||
      !reviewedCareerPolicy.models.some((id) => id === model) ||
      !Number.isFinite(now.getTime()) ||
      now.getTime() < Date.parse(reviewedCareerPolicy.reviewedAt) ||
      now.getTime() >= Date.parse(reviewedCareerPolicy.expiresAt)
    )
      throw new DomainError(
        "MODEL_ROUTE_INELIGIBLE",
        "Reviewed career-facts route is unreviewed, future-dated or expired.",
      );
  }
  return {
    only: [provider],
    allow_fallbacks: false as const,
    require_parameters: true as const,
    data_collection: revision === "strict-zdr-v1" ? ("deny" as const) : ("allow" as const),
    zdr: revision === "strict-zdr-v1",
    ...(revision === "reviewed-career-facts-v1"
      ? { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } }
      : {}),
  };
}

export function assertPrivacyRoute(
  route: {
    modelId: string | null;
    provider: string | null;
    privacyBinding?: string | null;
    lastCatalogueAt?: string | null;
  },
  revision: PrivacyRevision = "strict-zdr-v1",
  now = new Date(),
) {
  if (revision === "strict-zdr-v1") return;
  const age = now.getTime() - Date.parse(route.lastCatalogueAt ?? "");
  if (
    route.privacyBinding !== privacyBinding(revision) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age >= 21600000
  )
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Inference route lacks current privacy and endpoint evidence.",
    );
  providerPrivacy(route.modelId ?? "", route.provider ?? "", revision, now);
}

export function assertReviewedEndpoint(raw: unknown, model: string, provider: string) {
  const evidence = z
    .object({
      data: z
        .object({
          endpoints: z
            .array(
              z
                .object({
                  model_id: z.string(),
                  provider_name: z.string(),
                  tag: z.string(),
                  context_length: z.number().int().positive(),
                  pricing: z.record(z.string(), z.unknown()),
                  supported_parameters: z.array(z.string()),
                  status: z.number().int(),
                })
                .passthrough(),
            )
            .max(100),
        })
        .passthrough(),
    })
    .passthrough()
    .safeParse(raw);
  const endpoint =
    evidence.success &&
    evidence.data.data.endpoints.find(
      (item) =>
        item.model_id === model &&
        item.provider_name.toLowerCase() === provider &&
        (item.tag === provider || item.tag.startsWith(`${provider}/`)) &&
        item.status === 0 &&
        item.context_length >= 8192 &&
        item.supported_parameters.includes("structured_outputs") &&
        item.supported_parameters.includes("response_format") &&
        ["prompt", "completion"].every((key) => key in item.pricing) &&
        Object.entries(item.pricing).every(
          ([key, value]) =>
            ["prompt", "completion", "discount"].includes(key) &&
            (typeof value === "string" || typeof value === "number") &&
            String(value).trim() !== "" &&
            Number.isFinite(Number(value)) &&
            Number(value) === 0,
        ),
    );
  if (!endpoint)
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Reviewed provider endpoint lacks explicit free pricing or required capabilities.",
    );
  return endpoint;
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Space replacement preserves vacancy offsets used by local evidence validation.
export function careerTextMinimizer(facts: CandidateFact[]) {
  const privateValues = facts
    .flatMap((fact) => {
      if (fact.value.kind === "identity")
        return [
          fact.value.fullName,
          ...fact.value.fullName.split(/\s+/).filter((part) => part.length >= 3),
          fact.value.email,
          fact.value.phone,
          ...fact.value.links,
        ];
      if (fact.value.kind === "work_authorization")
        return [fact.value.approvedWording, fact.value.permitExpiresOn ?? ""];
      return [];
    })
    .filter((value) => value.trim().length >= 3)
    .sort((a, b) => b.length - a.length);
  const patterns = [
    ...privateValues.map((value) => new RegExp(escapePattern(value), "gi")),
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /(?:https?:\/\/|www\.)[^\s<>"']+/gi,
    /\b(?:sk-or-v1-|sk-|Bearer\s+)[a-zA-Z0-9_-]{12,}\b/g,
    /(?:[A-Z]:\\|\\\\)[^\s<>"']+/gi,
    /(?:\+\d[\d ()-]{7,}\d)/g,
    /[^.!?\n]*\b(?:visa|passport|nationality|citizenship|immigration|work permit|sponsorship|residence permit)\b[^.!?\n]*[.!?]?/gi,
  ];
  return (text: string) =>
    patterns.reduce(
      (value, pattern) => value.replace(pattern, (match) => " ".repeat(match.length)),
      text,
    );
}
