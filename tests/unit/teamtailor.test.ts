import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { normalizePage, pollSource } from "../../packages/discovery/src/connectors.js";
import { readFixture } from "../../packages/discovery/src/fixtures.js";
import { recognizeUrl } from "../../packages/discovery/src/normalize.js";
import { readPublic } from "../../packages/discovery/src/transport.js";
import { sourceFixture } from "../helpers/discovery-fixtures.js";

const source = { ...sourceFixture, connector: "teamtailor" as const };
const endpoint = "https://synthetic-board.teamtailor.com/jobs.rss?offset=0&per_page=100";
const wire = async () =>
  new XMLParser({ parseTagValue: false }).parse((await readFixture(endpoint)).body);
const build = (data: unknown) => new XMLBuilder().build(data) as string;
const response = (body: string) => ({ status: 200, body, etag: null, retryAfter: null });
describe("Teamtailor paginated public RSS", () => {
  it("normalizes descriptions, publication and namespace location evidence", async () => {
    const batch = await pollSource(source, readFixture);
    expect(batch.jobs).toHaveLength(3);
    expect(batch.pages).toHaveLength(1);
    expect(batch.jobs[0]).toMatchObject({
      source: "teamtailor",
      countryCode: "NL",
      city: "Amsterdam",
      remote: "hybrid",
      postingId: "501",
      postedAt: "2026-10-10T12:00:00.000Z",
      evidence: { page: 0, locator: "rss.channel.item[0]" },
    });
    expect(batch.jobs[0]?.description).not.toContain("<p>");
  });
  it("traverses full pages to a short terminal page", async () => {
    const template = await wire();
    const sample = template.rss.channel.item[0];
    const urls: string[] = [];
    const batch = await pollSource(
      source,
      async (url) => {
        urls.push(url);
        const offset = Number(new URL(url).searchParams.get("offset"));
        const items = Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({
          ...sample,
          guid: `global-${offset + index + 1}`,
          link: `https://synthetic-board.teamtailor.com/jobs/${offset + index + 1}-synthetic-role`,
        }));
        return response(build({ rss: { channel: { ...template.rss.channel, item: items } } }));
      },
      async () => {},
    );
    expect(batch.jobs).toHaveLength(101);
    expect(urls[1]).toContain("offset=100&per_page=100");
    expect(batch.jobs[100]?.evidence.page).toBe(1);
  });
  it("accepts a documented empty channel and refuses a renamed content collection", async () => {
    const template = await wire();
    delete template.rss.channel.item;
    expect(normalizePage(build(template), source, 0).jobs).toEqual([]);
    template.rss.channel.posts = "";
    expect(() => normalizePage(build(template), source, 0)).toThrow();
  });
  it.each(["channel", "posting"])("refuses tenant substitution in %s", async (target) => {
    const template = await wire();
    if (target === "channel") template.rss.channel.link = "https://evil.test";
    else template.rss.channel.item[0].link = "https://other.teamtailor.com/jobs/501-synthetic-role";
    expect(() => normalizePage(build(template), source, 0)).toThrow();
  });
  it.each(["global", "posting"])("refuses duplicate %s identity", async (target) => {
    const template = await wire();
    if (target === "global") template.rss.channel.item[1].guid = template.rss.channel.item[0].guid;
    else template.rss.channel.item[1].link = template.rss.channel.item[0].link;
    await expect(pollSource(source, async () => response(build(template)))).rejects.toMatchObject({
      health: "parser_failed",
    });
  });
  it("rejects a repeated full page rather than silently completing pagination", async () => {
    const template = await wire();
    const sample = template.rss.channel.item[0];
    template.rss.channel.item = Array.from({ length: 100 }, (_, index) => ({
      ...sample,
      guid: `global-${index + 1}`,
      link: `https://synthetic-board.teamtailor.com/jobs/${index + 1}-synthetic-role`,
    }));
    await expect(
      pollSource(
        source,
        async () => response(build(template)),
        async () => {},
      ),
    ).rejects.toMatchObject({ health: "parser_failed" });
  });
  it.each(["<!DOCTYPE rss><rss/>", "<html/>", "<rss><channel></rss>"])(
    "refuses unsafe or malformed XML",
    (body) => {
      expect(() => normalizePage(body, source, 0)).toThrow();
    },
  );
  it("recognizes only exact public tenant jobs", () => {
    expect(
      recognizeUrl("https://synthetic-board.teamtailor.com/jobs/501-synthetic-role?source=fixture"),
    ).toMatchObject({ connector: "teamtailor", board: "synthetic-board", postingId: "501" });
    expect(() =>
      recognizeUrl("https://synthetic-board.teamtailor.com.evil.test/jobs/501-role"),
    ).toThrow();
  });
  it("refuses other tenant API or job paths before HTTP", async () => {
    await expect(
      readPublic("https://synthetic-board.teamtailor.com/api/jobs"),
    ).rejects.toMatchObject({ health: "unavailable" });
    await expect(
      readPublic("https://synthetic-board.teamtailor.com/jobs.rss?per_page=100"),
    ).rejects.toMatchObject({ health: "unavailable" });
  });
});
