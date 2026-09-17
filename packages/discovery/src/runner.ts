import type { Config } from "../../config/src/index.js";
import { DomainError } from "../../contracts/src/index.js";
import type { DiscoveryRepository } from "../../persistence/src/discovery-repository.js";
import { pollSource } from "./connectors.js";
import { readFixture } from "./fixtures.js";
import { DiscoveryFailure, readPublic } from "./transport.js";

export async function runDiscovery(repo: DiscoveryRepository, profile: Config["profile"]) {
  const source = await repo.claimSource();
  if (!source) return false;
  try {
    if (profile === "demo" && source.mode !== "fixture")
      throw new DiscoveryFailure("forbidden", "Demo permits synthetic source fixtures only.");
    const batch = await pollSource(source, source.mode === "fixture" ? readFixture : readPublic);
    await repo.ingest(source, batch);
  } catch (error) {
    if (error instanceof DomainError && ["LEASE_STALE", "TASK_CANCELLED"].includes(error.code))
      return true;
    if (!(error instanceof DiscoveryFailure)) throw error;
    try {
      await repo.failSource(source, error.health, error.retryAfterMs, error.pages);
    } catch (saveError) {
      if (
        !(saveError instanceof DomainError) ||
        !["LEASE_STALE", "TASK_CANCELLED"].includes(saveError.code)
      )
        throw saveError;
    }
  }
  return true;
}
