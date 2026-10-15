import { DomainError } from "../../contracts/src/index.js";
import type { RoutePolicy } from "../../contracts/src/matching.js";
import { type PrivacyRevision, providerPrivacy } from "./privacy.js";
import { verifyRequestRoute } from "./router.js";

export { boundCompletionTokens, completionContextBound } from "./limits.js";

export interface CompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: {
    type: "json_schema";
    json_schema: { name: string; strict: true; schema: Record<string, unknown> };
  };
  temperature: 0;
  max_tokens: number;
  provider: {
    only: string[];
    allow_fallbacks: false;
    require_parameters: true;
    data_collection: "deny" | "allow";
    zdr: boolean;
    max_price?: { prompt: number; completion: number; request: number; image: number };
  };
}

export interface CompletionResponse {
  model: string;
  provider: string;
  content: string;
  usage: { promptTokens: number; completionTokens: number };
}

async function bounded(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Inference response exceeded its limit.");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function retryAfter(value: string | null): number {
  if (!value) return 60000;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.min(86400000, Math.max(60000, delay)) : 60000;
}

export class OpenRouterTransport {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly privacyRevision: PrivacyRevision = "strict-zdr-v1",
    private readonly routePolicy?: RoutePolicy,
  ) {}

  private async call(path: string, init?: RequestInit) {
    try {
      const response = await this.fetcher(`https://openrouter.ai/api/v1${path}`, {
        ...init,
        redirect: "error",
        signal: init?.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(path === "/chat/completions" ? 30000 : 15000),
            ])
          : AbortSignal.timeout(path === "/chat/completions" ? 30000 : 15000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (response.status === 429)
        throw new DomainError(
          "RATE_LIMITED",
          `Free inference is rate limited until ${new Date(Date.now() + retryAfter(response.headers.get("retry-after"))).toISOString()}.`,
          true,
        );
      if (response.status === 404 && path === "/chat/completions")
        throw new DomainError(
          "MODEL_ROUTE_INELIGIBLE",
          "No endpoint accepted the pinned model, provider, capability and privacy requirements.",
        );
      if (!response.ok)
        throw new DomainError(
          "MODEL_ROUTE_INELIGIBLE",
          `OpenRouter returned HTTP ${response.status}.`,
          response.status >= 500,
        );
      return JSON.parse(
        await bounded(response, path === "/models" ? 8 * 1024 * 1024 : 2 * 1024 * 1024),
      ) as unknown;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Inference transport failed closed.", true);
    }
  }

  catalogue(signal?: AbortSignal) {
    return this.call("/models", { signal: signal ?? null });
  }

  endpoints(model: string, signal?: AbortSignal) {
    if (!/^[a-zA-Z0-9_.~-]+\/[a-zA-Z0-9_.~:-]+:free$/.test(model))
      throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Invalid free endpoint model.");
    return this.call(`/models/${model}/endpoints`, { signal: signal ?? null });
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
    signal?.throwIfAborted();
    const expected = providerPrivacy(
      request.model,
      request.provider.only[0] ?? "",
      this.privacyRevision,
    );
    if (JSON.stringify(request.provider) !== JSON.stringify(expected))
      throw new DomainError(
        "MODEL_ROUTE_INELIGIBLE",
        "Inference privacy controls differed from the recorded revision.",
      );
    if (!this.routePolicy)
      throw new DomainError(
        "MODEL_ROUTE_INELIGIBLE",
        "Completion requires an explicit route policy.",
      );
    await verifyRequestRoute(request, this.routePolicy, this.privacyRevision, {
      catalogue: () => this.catalogue(signal),
      endpoints: (model) => this.endpoints(model, signal),
    });
    signal?.throwIfAborted();
    const raw = (await this.call("/chat/completions", {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify(request),
    })) as {
      model?: unknown;
      provider?: unknown;
      choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.model !== "string" ||
      typeof raw.provider !== "string" ||
      typeof raw.choices?.[0]?.message?.content !== "string"
    )
      throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Inference response shape was invalid.");
    const promptTokens = raw.usage?.prompt_tokens;
    const completionTokens = raw.usage?.completion_tokens;
    if (
      !Number.isSafeInteger(promptTokens) ||
      Number(promptTokens) < 0 ||
      !Number.isSafeInteger(completionTokens) ||
      Number(completionTokens) < 0 ||
      Number(completionTokens) > request.max_tokens ||
      (raw.choices[0].finish_reason !== undefined && raw.choices[0].finish_reason !== "stop")
    )
      throw new DomainError(
        "MODEL_ROUTE_INELIGIBLE",
        "Inference usage or finish status was invalid.",
      );
    const pinnedProvider = request.provider.only[0];
    if (!pinnedProvider || raw.provider.toLowerCase() !== pinnedProvider.toLowerCase())
      throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Inference provider differed from the pin.");
    return {
      model: raw.model,
      provider: pinnedProvider,
      content: raw.choices[0].message.content,
      usage: {
        promptTokens: Number(promptTokens),
        completionTokens: Number(completionTokens),
      },
    };
  }
}
