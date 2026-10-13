import { request } from "node:https";
import { hostedOriginSchema } from "../../contracts/src/hosted-preparation.js";
import { DomainError } from "../../contracts/src/index.js";
import { publicLookup } from "../../discovery/src/transport.js";

export type HostedRead = (
  url: string,
  origin: string,
  signal: AbortSignal,
) => Promise<{ body: Buffer; contentType: string }>;
export const readHostedPublic: HostedRead = async (raw, origin, signal) => {
  hostedOriginSchema.parse(origin);
  const url = new URL(raw);
  if (url.origin !== origin || url.username || url.password || url.port)
    throw new DomainError(
      "ORIGIN_DENIED",
      "Hosted resource is outside its approved public origin.",
    );
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  return new Promise((resolve, reject) => {
    const fail = () =>
      reject(
        new DomainError(
          "STORAGE_UNAVAILABLE",
          "Public hosted resource load failed or exceeded its bound.",
        ),
      );
    const req = request(
      url,
      {
        lookup: publicLookup,
        agent: false,
        signal: bounded,
        method: "GET",
        headers: {
          accept: "text/html,text/css,image/*,font/*",
          "accept-encoding": "identity",
          "user-agent": "OpenCareers public-read-only",
        },
      },
      (response) => {
        if (response.statusCode !== 200 || response.headers["content-encoding"]) {
          response.destroy();
          fail();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) {
            response.destroy();
            fail();
          } else chunks.push(Buffer.from(chunk));
        });
        response.once("error", fail);
        response.once("aborted", fail);
        response.once("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            contentType: response.headers["content-type"] ?? "application/octet-stream",
          }),
        );
      },
    );
    req.once("error", fail);
    req.end();
  });
};
