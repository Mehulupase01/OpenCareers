import { describe, expect, it } from "vitest";
import { sourceInputSchema } from "../../packages/contracts/src/discovery.js";
import { normalizePage, pollSource } from "../../packages/discovery/src/connectors.js";
import { readFixture } from "../../packages/discovery/src/fixtures.js";
import { recognizeUrl } from "../../packages/discovery/src/normalize.js";
import { readPublic } from "../../packages/discovery/src/transport.js";
import { sourceFixture } from "../helpers/discovery-fixtures.js";

const source = { ...sourceFixture, connector: "personio" as const, region: "eu" as const };
const endpoint = "https://synthetic-board.jobs.personio.de/xml?language=en";
const feed = async () => (await readFixture(endpoint)).body;
describe("Personio published XML discovery", () => {
  it("normalizes a complete XML board without inventing publication dates", async () => {
    const batch = await pollSource(source, readFixture);
    expect(batch.jobs).toHaveLength(3);
    expect(batch.pages).toHaveLength(1);
    expect(batch.pages[0]?.url).toBe(endpoint);
    expect(batch.jobs[0]).toMatchObject({
      source: "personio",
      postingId: "301",
      providerRequisition: "301",
      countryCode: "NL",
      city: "Amsterdam",
      remote: "unknown",
      postedAt: null,
      updatedAt: null,
      synthetic: true,
      canonicalUrl: "https://synthetic-board.jobs.personio.de/job/301",
      evidence: { page: 0, locator: "workzag-jobs.position[0]" },
    });
    expect(batch.jobs[0]?.description).toContain("Build reliable synthetic services");
    expect(batch.jobs[0]?.description).not.toContain("<p>");
  });
  it("supports com tenants without silently switching to de", async () => {
    const batch = await pollSource({ ...source, region: "global" }, readFixture);
    expect(batch.pages[0]?.url).toBe("https://synthetic-board.jobs.personio.com/xml?language=en");
    expect(batch.jobs[0]?.canonicalUrl).toContain(".personio.com/job/");
  });
  it.each(["<workzag-jobs/>", "<workzag-jobs></workzag-jobs>"])(
    "accepts only a documented empty root: %s",
    (xml) => {
      expect(normalizePage(xml, source, 0).jobs).toEqual([]);
    },
  );
  it.each([
    "<html><body>Sign in</body></html>",
    "<workzag-jobs><unexpected/></workzag-jobs>",
    "<workzag-jobs><position><id>1</id></position></workzag-jobs>",
    "<workzag-jobs><position></workzag-jobs>",
    '<!DOCTYPE workzag-jobs [<!ENTITY secret SYSTEM "file:///C:/secret">]><workzag-jobs/>',
    `<workzag-jobs>${"<nested>".repeat(40)}${"</nested>".repeat(40)}</workzag-jobs>`,
  ])("refuses malformed, hostile or drifted XML", (xml) => {
    expect(() => normalizePage(xml, source, 0)).toThrow();
  });
  it("handles single positions, entities and multiple description blocks", () => {
    const xml =
      "<workzag-jobs><position><id>401</id><name>Data &amp; Analytics Engineer</name><office>Unknown</office><jobDescriptions><jobDescription><name>Role</name><value><![CDATA[<p>First role section has enough detail.</p>]]></value></jobDescription><jobDescription><name>Skills</name><value>Python &amp; SQL</value></jobDescription></jobDescriptions></position></workzag-jobs>";
    const result = normalizePage(xml, source, 0);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.title).toBe("Data & Analytics Engineer");
    expect(result.jobs[0]?.description).toContain("Python & SQL");
    expect(result.jobs[0]?.countryCode).toBeUndefined();
  });
  it("fails duplicate identities and retains failed response evidence", async () => {
    const xml = (await feed()).replace("<id>302</id>", "<id>301</id>");
    await expect(
      pollSource(source, async () => ({ status: 200, body: xml, etag: null, retryAfter: null })),
    ).rejects.toMatchObject({
      health: "parser_failed",
      pages: [expect.objectContaining({ url: endpoint })],
    });
  });
  it("surfaces disabled feeds and backoff without claiming an empty complete scan", async () => {
    await expect(
      pollSource(source, async () => ({ status: 403, body: "", etag: null, retryAfter: null })),
    ).rejects.toMatchObject({ health: "forbidden" });
    await expect(
      pollSource(source, async () => ({ status: 429, body: "", etag: null, retryAfter: "120" })),
    ).rejects.toMatchObject({ health: "rate_limited", retryAfterMs: 120000 });
  });
  it.each([
    "https://synthetic-board.jobs.personio.de/job/301",
    "https://synthetic-board.jobs.personio.com/job/301?language=en",
  ])("recognizes exact public vacancy %s", (url) => {
    expect(recognizeUrl(url)).toMatchObject({
      connector: "personio",
      board: "synthetic-board",
      postingId: "301",
    });
  });
  it.each([
    "https://evil.jobs.personio.de.evil.test/job/301",
    "https://synthetic-board.jobs.personio.de/apply/301",
  ])("refuses unsupported vacancy %s", (url) => {
    expect(() => recognizeUrl(url)).toThrow();
  });
  it("rejects unsafe tenant tokens and non-feed paths before HTTP", async () => {
    expect(
      sourceInputSchema.safeParse({
        ...sourceInputSchema.strip().parse(source),
        board: "Wrong_Tenant",
      }).success,
    ).toBe(false);
    await expect(
      readPublic("https://synthetic-board.jobs.personio.de/job/301"),
    ).rejects.toMatchObject({ health: "unavailable" });
    await expect(
      readPublic("https://synthetic-board.jobs.personio.de/xml?language=en&redirect=evil"),
    ).rejects.toMatchObject({ health: "unavailable" });
  });
});
