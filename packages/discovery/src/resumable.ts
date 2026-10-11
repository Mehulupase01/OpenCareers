import { setTimeout as delay } from "node:timers/promises";
import type { DiscoverySource } from "../../contracts/src/discovery.js";
import type { ScanRead } from "../../contracts/src/discovery-scan.js";
import { DomainError } from "../../contracts/src/index.js";
import type { DiscoveryScanRepository } from "../../persistence/src/discovery-scan-repository.js";
import { pollSource } from "./connectors.js";
import { digest } from "./normalize.js";
import {
  DiscoveryFailure,
  pageEvidence,
  type ReadPublic,
  type ReadResponse,
  retryAfter,
} from "./transport.js";

export class DiscoveryYield extends DiscoveryFailure {
  constructor() {
    super("scanning", "Public scan checkpointed for the next bounded slice.");
  }
}
const sameResponse = (left: ReadResponse, right: ReadResponse) =>
  left.status === right.status &&
  left.location === right.location &&
  digest(left.body) === digest(right.body);

export async function pollResumable(
  repo: DiscoveryScanRepository,
  source: DiscoverySource,
  transport: ReadPublic,
  options: { maxReads?: number; clock?: () => Date } = {},
) {
  const maxReads = options.maxReads ?? 5;
  if (!Number.isInteger(maxReads) || maxReads < 2 || maxReads > 5)
    throw new DomainError("CONFIG_INVALID", "Invalid public scan slice budget.");
  const clock = options.clock ?? (() => new Date());
  let reads: ScanRead[];
  try {
    reads = await repo.loadScan(source);
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "STATE_INVALID") throw error;
    await repo.discardScan(source);
    throw new DiscoveryFailure("parser_failed", "Public scan cache integrity failed.");
  }
  let actual = 0;
  let nextReadAt = 0;
  let ordinal = 0;
  const urls = new Set<string>();
  const cached = new Set<number>();
  const save = async (record: ScanRead) => {
    try {
      await repo.saveScanRead(source, record);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "CONFIG_INVALID") throw error;
      throw new DiscoveryFailure(
        "parser_failed",
        "Public scan checkpoint exceeds its bounded storage contract.",
      );
    }
  };
  const fresh: ReadPublic = async (url, etag, signal) => {
    await repo.checkScanLease(source);
    if (actual >= maxReads) throw new DiscoveryYield();
    await delay(Math.max(0, nextReadAt - performance.now()), undefined, { signal });
    actual++;
    let response: ReadResponse;
    try {
      response = await transport(url, etag, signal);
    } finally {
      nextReadAt = performance.now() + 250;
    }
    return { ...response, fetchedAt: clock().toISOString(), location: response.location ?? null };
  };
  const drift = async () => {
    await repo.discardScan(source);
    throw new DiscoveryFailure(
      "quality_warning",
      "Public feed changed while resuming; prior vacancies retained.",
    );
  };
  const read: ReadPublic = async (url, etag, signal) => {
    await repo.checkScanLease(source);
    const position = ordinal++;
    const previous = reads[position];
    if (previous && (previous.url !== url || previous.requestEtag !== (etag ?? null)))
      return drift();
    // The anchor and repeated consistency checks always reach the public transport.
    const forceFresh = position === 0 || urls.has(url);
    urls.add(url);
    if (previous && !forceFresh) {
      cached.add(position);
      return previous.response;
    }
    const response = await fresh(url, etag, signal);
    if (response.status !== 200 && response.status !== 302) return response;
    if (previous && !sameResponse(previous.response, response)) return drift();
    const record: ScanRead = {
      ordinal: position,
      url,
      requestEtag: etag ?? null,
      revalidated: forceFresh,
      response: {
        ...response,
        status: response.status,
        retryAfter: null,
        location: response.location ?? null,
        fetchedAt: response.fetchedAt as string,
      },
      verifiedAt: clock().toISOString(),
    };
    await save(record);
    reads[position] = record;
    return response;
  };
  const batch = await pollSource(source, read);
  // No partial ingest. Revalidate reused reads in bounded slices, preserving original fetch evidence.
  for (const position of cached) {
    const previous = reads[position];
    if (!previous) throw new DomainError("STATE_INVALID", "Missing public scan checkpoint.");
    const age = clock().getTime() - Date.parse(previous.verifiedAt);
    if (previous.revalidated && age >= 0 && age <= 300000) continue;
    const response = await fresh(previous.url, previous.requestEtag);
    batch.pages.push(pageEvidence(previous.url, response, clock()));
    if (response.status === 429)
      throw new DiscoveryFailure(
        "rate_limited",
        "Source requested backoff.",
        retryAfter(response.retryAfter, clock().getTime()),
        batch.pages,
      );
    if (response.status === 403)
      throw new DiscoveryFailure("forbidden", "Source denied public access.", 0, batch.pages);
    if (response.status !== 200 && response.status !== 302)
      throw new DiscoveryFailure("unavailable", "Public scan revalidation failed.", 0, batch.pages);
    if (!sameResponse(previous.response, response)) return drift();
    await save({
      ...previous,
      response: {
        ...previous.response,
        ...response,
        status: previous.response.status,
        retryAfter: null,
        location: response.location ?? null,
        fetchedAt: response.fetchedAt as string,
      },
      revalidated: true,
      verifiedAt: clock().toISOString(),
    });
  }
  return batch;
}
