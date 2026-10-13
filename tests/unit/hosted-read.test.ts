import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { readHostedPublic } from "../../packages/browser/src/hosted-read.js";
import { publicLookup } from "../../packages/discovery/src/transport.js";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: transport.request }));
const origin = "https://careers.synthetic.test";

function respond(
  status = 200,
  headers: Record<string, string> = {},
  chunks = [Buffer.from("public form")],
) {
  const response = Object.assign(new EventEmitter(), {
    statusCode: status,
    headers,
    destroy: vi.fn(),
  });
  transport.request.mockImplementation((_url, _options, callback) => {
    const request = Object.assign(new EventEmitter(), {
      end: () =>
        queueMicrotask(() => {
          callback(response);
          for (const chunk of chunks) response.emit("data", chunk);
          response.emit("end");
        }),
    });
    return request;
  });
  return response;
}
afterEach(() => vi.resetAllMocks());

it("uses isolated anonymous GET with public DNS pinning and a bounded signal", async () => {
  respond(200, { "content-type": "text/html", "set-cookie": "private=not-forwarded" });
  const controller = new AbortController();
  const result = await readHostedPublic(`${origin}/jobs/123`, origin, controller.signal);
  expect(result).toEqual({ body: Buffer.from("public form"), contentType: "text/html" });
  const [url, options] = transport.request.mock.calls[0] ?? [];
  expect(url.href).toBe(`${origin}/jobs/123`);
  expect(options).toMatchObject({ method: "GET", agent: false, lookup: publicLookup });
  expect(options.headers).toEqual({
    accept: "text/html,text/css,image/*,font/*",
    "accept-encoding": "identity",
    "user-agent": "OpenCareers public-read-only",
  });
  controller.abort();
  expect(options.signal.aborted).toBe(true);
});

it.each([301, 302, 401, 403, 429, 500])(
  "refuses status %s without following redirects or login",
  async (status) => {
    const response = respond(status, { location: "https://127.0.0.1/private" });
    await expect(
      readHostedPublic(`${origin}/jobs`, origin, new AbortController().signal),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(response.destroy).toHaveBeenCalledOnce();
    expect(transport.request).toHaveBeenCalledOnce();
  },
);
it("rejects compressed and oversized resources", async () => {
  respond(200, { "content-encoding": "gzip" });
  await expect(
    readHostedPublic(`${origin}/jobs`, origin, new AbortController().signal),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  const response = respond(200, {}, [Buffer.alloc(8 * 1024 * 1024 + 1)]);
  await expect(
    readHostedPublic(`${origin}/jobs`, origin, new AbortController().signal),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  expect(response.destroy).toHaveBeenCalledOnce();
});
it("returns a sanitized error on transport failure", async () => {
  transport.request.mockImplementation(() => {
    const request = Object.assign(new EventEmitter(), {
      end: () => queueMicrotask(() => request.emit("error", new Error("secret endpoint detail"))),
    });
    return request;
  });
  await expect(
    readHostedPublic(`${origin}/jobs`, origin, new AbortController().signal),
  ).rejects.toThrow("Public hosted resource load failed or exceeded its bound.");
});
it("rejects unapproved origins, credentials and private destination shapes before a request", async () => {
  for (const url of [
    "https://unapproved.synthetic.test/jobs",
    "https://owner:secret@careers.synthetic.test/jobs",
    `${origin}:8443/jobs`,
    "https://127.0.0.1/jobs",
  ])
    await expect(readHostedPublic(url, origin, new AbortController().signal)).rejects.toMatchObject(
      { code: "ORIGIN_DENIED" },
    );
  expect(transport.request).not.toHaveBeenCalled();
});
it.each([
  "/jobs?access_token=private",
  "/jobs?%74oken=private",
  "/jobs?%2574oken=private",
  "/jobs?X-Amz-Signature=private",
  "/jobs?code=private",
  "/jobs?action=submit",
  "/oauth/callback",
  "/verify",
  "/%76erify",
  "/%2576erify",
  "/jobs%2Fverify/synthetic-private",
  "/jobs%5Cverify/synthetic-private",
  "/jobs/%",
  "/submit.php",
  "/logout",
])("rejects credential and state-changing URLs before transport: %s", async (path) => {
  await expect(
    readHostedPublic(origin + path, origin, new AbortController().signal),
  ).rejects.toMatchObject({ code: "ORIGIN_DENIED" });
  expect(transport.request).not.toHaveBeenCalled();
});
it("preserves ordinary vacancy selectors, tracking and locale queries", async () => {
  respond();
  await expect(
    readHostedPublic(
      `${origin}/apply?job_id=123&source=linkedin&lang=en`,
      origin,
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ body: Buffer.from("public form") });
});
