import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { normalizePage, pollSource } from "../../packages/discovery/src/connectors.js";
import { readFixture } from "../../packages/discovery/src/fixtures.js";
import { recognizeUrl } from "../../packages/discovery/src/normalize.js";
import { type ReadPublic, readPublic } from "../../packages/discovery/src/transport.js";
import { sourceFixture } from "../helpers/discovery-fixtures.js";

const source = { ...sourceFixture, connector: "smartrecruiters" as const };
const base = "https://api.smartrecruiters.com/v1/companies/synthetic-board/postings";
const noDelay = async () => {};
const response = (body: unknown) => ({
  status: 200,
  body: JSON.stringify(body),
  etag: null,
  retryAfter: null,
});
const detail = async () => JSON.parse((await readFixture(`${base}/401`)).body);
const list = async () =>
  JSON.parse((await readFixture(`${base}?destination=PUBLIC&limit=100&offset=0`)).body);
const largeReader = async (total: number): Promise<ReadPublic> => {
  const sample = await detail();
  return async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/postings")) {
      const offset = Number(url.searchParams.get("offset"));
      return response({
        limit: 100,
        offset,
        totalFound: total,
        content: Array.from({ length: Math.min(100, total - offset) }, (_, index) => ({
          id: String(offset + index + 1),
          name: "Synthetic Software Engineer",
          company: { identifier: source.board },
        })),
      });
    }
    const id = url.pathname.split("/").at(-1);
    return response({
      ...sample,
      id,
      postingUrl: `https://jobs.smartrecruiters.com/${source.board}/${id}-synthetic-role`,
    });
  };
};
afterEach(() => {
  vi.restoreAllMocks();
});
describe("SmartRecruiters bounded public discovery", () => {
  it("reads public summaries plus full details with dated evidence locators", async () => {
    const batch = await pollSource(source, readFixture, noDelay);
    expect(batch.jobs).toHaveLength(3);
    expect(batch.pages).toHaveLength(4);
    expect(batch.pages[0]?.url).toBe(`${base}?destination=PUBLIC&limit=100&offset=0`);
    expect(batch.jobs[0]).toMatchObject({
      source: "smartrecruiters",
      postingId: "401",
      providerRequisition: "REF-401",
      countryCode: "NL",
      city: "Amsterdam",
      remote: "remote",
      synthetic: true,
      evidence: { page: 1, locator: "$" },
    });
    expect(batch.pages[1]?.url).toBe(`${base}/401`);
    expect(batch.jobs[0]?.description).toContain("reliable synthetic");
    expect(batch.jobs[0]?.description).not.toContain("<p>");
  });
  it("traverses two pages and validates total counts rather than assuming short pages", async () => {
    const batch = await pollSource(source, await largeReader(101), noDelay);
    expect(batch.jobs).toHaveLength(101);
    expect(batch.pages).toHaveLength(103);
    expect(batch.pages[101]?.url).toContain("offset=100");
    expect(batch.jobs[100]?.evidence.page).toBe(102);
  });
  it("fails closed at request capacity and retains evidence without returning a partial snapshot", async () => {
    await expect(pollSource(source, await largeReader(200), noDelay)).rejects.toMatchObject({
      health: "unavailable",
      pages: expect.any(Array),
    });
  });
  it.each(["offset", "totalFound", "content"])(
    "rejects incomplete/shifted pagination: %s",
    async (field) => {
      const data = await list();
      if (field === "offset") data.offset = 100;
      else if (field === "totalFound") data.totalFound = 4;
      else data.content.pop();
      await expect(pollSource(source, async () => response(data), noDelay)).rejects.toMatchObject({
        health: "parser_failed",
      });
    },
  );
  it("rejects changes to the advertised total across pages", async () => {
    const read = await largeReader(101);
    await expect(
      pollSource(
        source,
        async (url) => {
          const result = await read(url);
          if (url.includes("offset=100")) {
            const body = JSON.parse(result.body);
            body.totalFound = 102;
            return response(body);
          }
          return result;
        },
        noDelay,
      ),
    ).rejects.toMatchObject({ health: "parser_failed" });
  });
  it.each(["duplicate", "company"])("rejects summary identity drift: %s", async (kind) => {
    const data = await list();
    if (kind === "duplicate") data.content[1] = data.content[0];
    else data.content[0].company.identifier = "another-company";
    await expect(
      pollSource(
        source,
        async (url) => (url.includes("?") ? response(data) : readFixture(url)),
        noDelay,
      ),
    ).rejects.toMatchObject({ health: "parser_failed" });
  });
  it.each(["inactive", "host", "company", "id", "description"])(
    "refuses drifted detail: %s",
    async (kind) => {
      const data = await detail();
      if (kind === "inactive") data.active = false;
      else if (kind === "host") data.postingUrl = "https://evil.test/synthetic-board/401";
      else if (kind === "company") data.company.identifier = "other";
      else if (kind === "id") data.id = "999";
      else delete data.jobAd.sections.jobDescription;
      expect(() => normalizePage(data, source, 1)).toThrow();
    },
  );
  it("does not follow a summary ref and rejects detail/list ID mismatch", async () => {
    const data = await list();
    data.content[0].ref = "https://evil.test/steal";
    const urls: string[] = [];
    const batch = await pollSource(
      source,
      async (url) => {
        urls.push(url);
        return url.includes("?") ? response(data) : readFixture(url);
      },
      noDelay,
    );
    expect(batch.jobs).toHaveLength(3);
    expect(urls.every((url) => url.startsWith(base))).toBe(true);
    const wrong = await detail();
    wrong.id = "999";
    wrong.postingUrl = "https://jobs.smartrecruiters.com/synthetic-board/999";
    await expect(
      pollSource(
        source,
        async (url) => (url.includes("?") ? readFixture(url) : response(wrong)),
        noDelay,
      ),
    ).rejects.toMatchObject({ health: "parser_failed" });
  });
  it("surfaces detail backoff and does not downgrade to summary-only matches", async () => {
    await expect(
      pollSource(
        source,
        async (url) =>
          url.includes("?")
            ? readFixture(url)
            : { status: 429, body: "", etag: null, retryAfter: "60" },
        noDelay,
      ),
    ).rejects.toMatchObject({ health: "rate_limited", retryAfterMs: 60000 });
  });
  it("stops before another request when its deadline expires during the delay", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const read = vi.fn(readFixture);
    await expect(
      pollSource(source, read, async () => {
        controller.abort();
      }),
    ).rejects.toMatchObject({ health: "unavailable" });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("recognizes exact hosted IDs while removing title and tracking variance", () => {
    expect(
      recognizeUrl(
        "https://jobs.smartrecruiters.com/synthetic-board/401-synthetic-title?trid=fixture",
      ),
    ).toMatchObject({
      connector: "smartrecruiters",
      board: "synthetic-board",
      postingId: "401",
      canonicalUrl: "https://jobs.smartrecruiters.com/synthetic-board/401",
    });
  });
  it("rejects private/employer routes and destinations before HTTP", async () => {
    for (const url of [
      `${base}?destination=INTERNAL&limit=100&offset=0`,
      `${base}?limit=100&offset=0`,
      "https://api.smartrecruiters.com/jobs",
      `${base}/401/candidates`,
    ])
      await expect(readPublic(url)).rejects.toMatchObject({ health: "unavailable" });
    expect(
      sourceInputSchema.safeParse({ ...sourceInputSchema.strip().parse(source), region: "eu" })
        .success,
    ).toBe(false);
  });
});
