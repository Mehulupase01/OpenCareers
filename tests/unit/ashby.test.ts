import { describe, expect, it } from "vitest";
import { sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { normalizePage, pollSource } from "../../packages/discovery/src/connectors.js";
import { readFixture } from "../../packages/discovery/src/fixtures.js";
import { recognizeUrl } from "../../packages/discovery/src/normalize.js";
import { readPublic } from "../../packages/discovery/src/transport.js";
import { sourceFixture } from "../helpers/discovery-fixtures.js";

const source = { ...sourceFixture, connector: "ashby" as const };
const endpoint = "https://api.ashbyhq.com/posting-api/job-board/synthetic-board";
const feed = async () => JSON.parse((await readFixture(endpoint)).body);
describe("Ashby public posting discovery", () => {
  it("normalizes a complete listed board with exact identity and location evidence", async () => {
    const batch = await pollSource(source, readFixture);
    expect(batch.jobs).toHaveLength(3);
    expect(batch.pages).toHaveLength(1);
    expect(batch.jobs[0]).toMatchObject({
      source: "ashby",
      countryCode: "NL",
      city: "Amsterdam",
      remote: "hybrid",
      synthetic: true,
      evidence: { page: 0, locator: "jobs[0]" },
      providerRequisition: null,
    });
    expect(batch.jobs[0]?.requisitionId).toContain("ashby:global:synthetic-board:synthetic-1");
    expect(batch.pages[0]?.url).toBe(endpoint);
  });
  it("does not index unlisted jobs or infer Netherlands from an unknown explicit country", async () => {
    const data = await feed();
    data.jobs[0].isListed = false;
    data.jobs[1].location = "Amsterdam";
    data.jobs[1].address.postalAddress.addressCountry = "European Union";
    const result = normalizePage(data, source, 0);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.countryCode).toBeUndefined();
    expect(result.jobs[0]?.city).toBeNull();
  });
  it.each([
    "https://evil.synthetic.example/synthetic-board/synthetic-1",
    "https://jobs.ashbyhq.com/other-board/synthetic-1",
    "https://jobs.ashbyhq.com.evil.test/synthetic-board/synthetic-1",
  ])("refuses posting URL %s", async (url) => {
    const data = await feed();
    data.jobs[0].jobUrl = url;
    expect(() => normalizePage(data, source, 0)).toThrow();
  });
  it("fails the whole snapshot for schema drift or duplicate IDs", async () => {
    const data = await feed();
    delete data.jobs[0].isListed;
    expect(() => normalizePage(data, source, 0)).toThrow();
    const duplicate = await feed();
    duplicate.jobs.push(duplicate.jobs[0]);
    await expect(
      pollSource(source, async () => ({
        status: 200,
        body: JSON.stringify(duplicate),
        etag: null,
        retryAfter: null,
      })),
    ).rejects.toMatchObject({ health: "parser_failed" });
  });
  it("requires the global endpoint and refuses employer API paths before HTTP", async () => {
    expect(
      sourceInputSchema.safeParse({ ...sourceInputSchema.strip().parse(source), region: "eu" })
        .success,
    ).toBe(false);
    await expect(readPublic("https://api.ashbyhq.com/jobPosting.list")).rejects.toMatchObject({
      health: "unavailable",
    });
  });
  it("recognizes the exact hosted vacancy and application path without redirectors", () => {
    expect(
      recognizeUrl(
        "https://jobs.ashbyhq.com/synthetic-board/synthetic-1/application?utm_source=fixture",
      ),
    ).toMatchObject({
      connector: "ashby",
      board: "synthetic-board",
      postingId: "synthetic-1",
      canonicalUrl: "https://jobs.ashbyhq.com/synthetic-board/synthetic-1",
    });
  });
});
