import { request } from "node:https";
import { hostedOriginSchema } from "../../contracts/src/hosted-preparation.js";
import { DomainError } from "../../contracts/src/index.js";
import { publicLookup } from "../../discovery/src/transport.js";

export type HostedRead = (
  url: string,
  origin: string,
  signal: AbortSignal,
) => Promise<{ body: Buffer; contentType: string }>;
export function assertHostedPublicUrl(raw: string, origin: string) {
  hostedOriginSchema.parse(origin);
  const url = new URL(raw);
  const credentialKeys = new Set([
    "token",
    "access_token",
    "id_token",
    "refresh_token",
    "authorization",
    "auth",
    "api_key",
    "apikey",
    "password",
    "session",
    "session_id",
    "sessionid",
    "csrf",
    "signature",
    "sig",
    "code",
    "x-amz-signature",
    "x-amz-credential",
    "x-goog-signature",
    "x-goog-credential",
  ]);
  const unsafeQuery = [...url.searchParams].some(
    ([key, value]) =>
      key.includes("%") ||
      credentialKeys.has(key.toLowerCase()) ||
      /(?:_|-)token$/i.test(key) ||
      (["action", "operation", "command", "do"].includes(key.toLowerCase()) &&
        /^(?:submit|create|delete|verify|confirm|activate|login|logout|signup|reset)$/i.test(
          value,
        )),
  );
  let unsafePath: boolean;
  try {
    unsafePath = decodeURIComponent(url.pathname)
      .split(/[\\/]/)
      .some((decoded) => {
        return (
          decoded.includes("%") ||
          /^(?:oauth|oauth2|callback|verify|verification|activate|confirm|logout|login|signin|signout|submit|reset-password)(?:\.[a-z0-9]+)?$/i.test(
            decoded,
          )
        );
      });
  } catch {
    unsafePath = true;
  }
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.port ||
    unsafeQuery ||
    unsafePath
  )
    throw new DomainError(
      "ORIGIN_DENIED",
      "Hosted resource requires a reviewed public URL without credentials or account actions.",
    );
  return url;
}
export const readHostedPublic: HostedRead = async (raw, origin, signal) => {
  const url = assertHostedPublicUrl(raw, origin);
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
