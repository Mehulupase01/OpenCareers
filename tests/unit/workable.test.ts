import { describe, expect, it } from "vitest";
import { sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { normalizePage, pollSource } from "../../packages/discovery/src/connectors.js";
import { readFixture } from "../../packages/discovery/src/fixtures.js";
import { recognizeUrl } from "../../packages/discovery/src/normalize.js";
import { readPublic } from "../../packages/discovery/src/transport.js";
import { sourceFixture } from "../helpers/discovery-fixtures.js";

const source = { ...sourceFixture, connector: "workable" as const };
const widget = "https://apply.workable.com/api/v1/widget/accounts/synthetic-board?details=true";
const feed = async () => JSON.parse((await readFixture(widget)).body);
describe("Workable public account discovery", () => {
  it("retains redirect and complete feed evidence with full descriptions", async () => {
    const batch = await pollSource(source, readFixture);
    expect(batch.jobs).toHaveLength(3);
    expect(batch.pages).toHaveLength(2);
    expect(batch.pages[0]?.status).toBe(302);
    expect(batch.pages[1]?.url).toBe(widget);
    expect(batch.jobs[0]).toMatchObject({
      source: "workable",
      countryCode: "NL",
      city: "Amsterdam",
      remote: "unknown",
      providerRequisition: null,
      postingId: "SYNTHETIC1",
      canonicalUrl: "https://apply.workable.com/synthetic-board/j/SYNTHETIC1",
      postedAt: "2026-10-10T00:00:00.000Z",
      evidence: { page: 1, locator: "jobs[0]" },
    });
    expect(batch.jobs[0]?.description).not.toContain("<p>");
  });
  it("allows a direct account response and geographic state names", async () => {
    const data = await feed();
    data.jobs[0].state = "North Holland";
    const batch = await pollSource(source, async () => ({
      status: 200,
      body: JSON.stringify(data),
      etag: null,
      retryAfter: null,
    }));
    expect(batch.pages).toHaveLength(1);
    expect(batch.jobs[0]?.evidence.page).toBe(0);
  });
  it.each([
    "https://evil.test/api",
    "https://apply.workable.com/api/v1/widget/accounts/another-tenant?details=true",
    "https://apply.workable.com/api/v1/widget/accounts/synthetic-board?details=true&x=1",
  ])("does not follow unauthorized redirect %s", async (location) => {
    let calls = 0;
    await expect(
      pollSource(source, async () => {
        calls++;
        return { status: 302, body: "", location, etag: null, retryAfter: null };
      }),
    ).rejects.toMatchObject({ health: "unavailable" });
    expect(calls).toBe(1);
  });
  it.each([
    "https://evil.test/j/SYNTHETIC1",
    "https://apply.workable.com/another-tenant/j/SYNTHETIC1",
    "https://apply.workable.com/j/OTHER",
    "https://apply.workable.com@evil.test/j/SYNTHETIC1",
  ])("refuses published URL substitution %s", async (url) => {
    const data = await feed();
    data.jobs[0].url = url;
    expect(() => normalizePage(data, source, 0)).toThrow();
  });
  it("rejects duplicates and missing descriptions without claiming a complete scan", async () => {
    const data = await feed();
    delete data.jobs[0].description;
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
  it("does not use hidden locations and preserves unknown publication dates", async () => {
    const data = await feed();
    data.jobs[0].locations[0].hidden = true;
    delete data.jobs[0].published_on;
    const job = normalizePage(data, source, 0).jobs[0];
    expect(job?.location).toBe("Unknown");
    expect(job?.countryCode).toBeUndefined();
    expect(job?.postedAt).toBeNull();
  });
  it("recognizes only account-bound hosted URLs", () => {
    expect(
      recognizeUrl("https://apply.workable.com/synthetic-board/j/SYNTHETIC1/apply?source=fixture"),
    ).toMatchObject({ connector: "workable", board: "synthetic-board", postingId: "SYNTHETIC1" });
    expect(() => recognizeUrl("https://apply.workable.com/j/SYNTHETIC1")).toThrow();
  });
  it("refuses employer or application routes before HTTP", async () => {
    await expect(
      readPublic("https://apply.workable.com/synthetic-board/j/SYNTHETIC1"),
    ).rejects.toMatchObject({ health: "unavailable" });
    await expect(readPublic("https://www.workable.com/spi/v3/jobs")).rejects.toMatchObject({
      health: "unavailable",
    });
    expect(
      sourceInputSchema.safeParse({ ...sourceInputSchema.strip().parse(source), region: "eu" })
        .success,
    ).toBe(false);
  });
});
