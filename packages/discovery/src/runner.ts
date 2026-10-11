import type { Config } from "../../config/src/index.js";
import { DomainError } from "../../contracts/src/index.js";
import type { DiscoveryScanRepository } from "../../persistence/src/discovery-scan-repository.js";
import { pollSource } from "./connectors.js";
import { readFixture } from "./fixtures.js";
import { DiscoveryYield, pollResumable } from "./resumable.js";
import { DiscoveryFailure, type ReadPublic, readPublic } from "./transport.js";

export async function runDiscovery(
  repo: DiscoveryScanRepository,
  profile: Config["profile"],
  read: ReadPublic = readPublic,
) {
  const source = await repo.claimSource();
  if (!source) return false;
  try {
    if (profile === "demo" && source.mode !== "fixture")
      throw new DiscoveryFailure("forbidden", "Demo permits synthetic source fixtures only.");
    const batch =
      source.mode === "fixture"
        ? await pollSource(source, readFixture)
        : await pollResumable(repo, source, read);
    await repo.ingest(source, batch);
  } catch (error) {
    if (error instanceof DomainError && ["LEASE_STALE", "TASK_CANCELLED"].includes(error.code))
      return true;
    if (!(error instanceof DiscoveryFailure)) throw error;
    try {
      if (error instanceof DiscoveryYield) await repo.deferScan(source);
      else await repo.failSource(source, error.health, error.retryAfterMs, error.pages);
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
