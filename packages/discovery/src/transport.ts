import { lookup } from "node:dns";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import type { SourceHealth, SourcePage } from "../../contracts/src/discovery.js";
import { digest } from "./normalize.js";

export class DiscoveryFailure extends Error {
  constructor(
    public readonly health: SourceHealth,
    message: string,
    public readonly retryAfterMs = 0,
    public pages: SourcePage[] = [],
  ) {
    super(message);
  }
}
export interface ReadResponse {
  status: number;
  body: string;
  etag: string | null;
  retryAfter: string | null;
}
export type ReadPublic = (
  url: string,
  etag?: string | null,
  signal?: AbortSignal,
) => Promise<ReadResponse>;
const hosts = new Set(["boards-api.greenhouse.io", "api.lever.co", "api.eu.lever.co"]);
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, family: options.family ?? 0 }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      return callback(new Error("Non-public source destination rejected."), "", 4);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]?.address ?? "", addresses[0]?.family ?? 4);
  });
};
export const readPublic: ReadPublic = async (input, etag, signal) => {
  const url = new URL(input);
  if (
    !hosts.has(url.hostname) ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password
  )
    throw new DiscoveryFailure("unavailable", "Unapproved public source origin.");
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        agent: false,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "identity",
          "User-Agent": "OpenCareers/0.1 public-job-reader",
          ...(etag ? { "If-None-Match": etag } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) req.destroy(new Error("Source response limit exceeded."));
          else chunks.push(chunk);
        });
        response.on("error", () =>
          reject(new DiscoveryFailure("unavailable", "Public source response interrupted.")),
        );
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            etag: response.headers.etag?.slice(0, 1000) ?? null,
            retryAfter:
              typeof response.headers["retry-after"] === "string"
                ? response.headers["retry-after"]
                : null,
          }),
        );
      },
    );
    req.on("error", () =>
      reject(
        new DiscoveryFailure("unavailable", "Public source read failed or exceeded its limit."),
      ),
    );
    req.end();
  });
};
export function retryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.min(86400000, Math.max(0, delay)) : 0;
}
export function pageEvidence(url: string, response: ReadResponse, now: Date): SourcePage {
  return {
    url,
    status: response.status,
    body: response.body,
    sha256: digest(response.body),
    etag: response.etag,
    fetchedAt: now.toISOString(),
  };
}
