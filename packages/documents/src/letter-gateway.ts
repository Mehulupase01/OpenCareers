import { createHash } from "node:crypto";
import type { PacketContent } from "../../contracts/src/documents.js";
import { DomainError } from "../../contracts/src/index.js";
import type { OpenRouterTransport } from "../../inference/src/transport.js";
import type { MatchingRepository } from "../../persistence/src/matching-repository.js";
import type { PacketGenerationInput } from "./domain.js";
import { buildLetterRequest, compileLetterProposal } from "./letter-draft.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class LetterDraftRunner {
  constructor(
    private readonly ledger: Pick<
      MatchingRepository,
      "snapshot" | "reserve" | "markSent" | "finish" | "release" | "setUnavailable"
    >,
    private readonly dailyLimit: number,
    private readonly transport: Pick<OpenRouterTransport, "complete">,
  ) {}

  async draft(input: PacketGenerationInput, content: PacketContent) {
    const route = (await this.ledger.snapshot(this.dailyLimit)).route;
    if (route.status !== "ready" || !route.modelId || !route.provider)
      throw new DomainError("MODEL_ROUTE_INELIGIBLE", "No reviewed free letter route is ready.");
    const request = buildLetterRequest(input, content, route.modelId, route.provider);
    const reservation = await this.ledger.reserve(
      route.modelId,
      route.provider,
      this.dailyLimit,
      input.assessment.applicationId ?? undefined,
    );
    let sent = false;
    try {
      await this.ledger.markSent(reservation.id, digest(JSON.stringify(request)));
      sent = true;
      const response = await this.transport.complete(request);
      if (
        ![route.modelId, route.modelId.replace(/:free$/, "")].includes(response.model) ||
        response.provider !== route.provider
      )
        throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Letter inference route changed.");
      if (response.content.length > 20000)
        throw new DomainError("MODEL_ROUTE_INELIGIBLE", "Letter proposal exceeded its limit.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.content);
      } catch {
        throw new DomainError("CLAIM_UNSUPPORTED", "Letter proposal was not valid JSON.");
      }
      const letter = compileLetterProposal(input, content, parsed);
      await this.ledger.finish(reservation.id, {
        status: "completed",
        responseHash: digest(response.content),
      });
      return {
        letter,
        modelId: route.modelId,
        provider: route.provider,
        responseHash: digest(response.content),
      };
    } catch (error) {
      if (!sent) await this.ledger.release(reservation.id);
      else
        await this.ledger.finish(reservation.id, {
          status: "failed",
          errorCode: error instanceof DomainError ? error.code : "MODEL_ROUTE_INELIGIBLE",
          ...(error instanceof DomainError && error.code === "RATE_LIMITED"
            ? { backoffUntil: new Date(Date.now() + 120000).toISOString() }
            : {}),
        });
      if (error instanceof DomainError && error.code === "RATE_LIMITED") throw error;
      throw error instanceof DomainError
        ? error
        : new DomainError("MODEL_ROUTE_INELIGIBLE", "Letter inference failed closed.");
    }
  }
}
