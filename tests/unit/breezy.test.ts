import { describe, expect, it } from "vitest";
import { pollSource } from "../../packages/discovery/src/connectors.js";
import { readFixture } from "../../packages/discovery/src/fixtures.js";
import { recognizeUrl } from "../../packages/discovery/src/normalize.js";
import { readPublic } from "../../packages/discovery/src/transport.js";
import { sourceFixture } from "../helpers/discovery-fixtures.js";

const source = { ...sourceFixture, connector: "breezy" as const };
const read = (mutate: (body: string, url: string, call: number) => string, status = 200) => {
  let call = 0;
  return async (url: string) => ({
    ...(await readFixture(url)),
    status,
    body: mutate((await readFixture(url)).body, url, ++call),
  });
};
const noDelay = async () => {};
describe("Breezy public listing and structured vacancy evidence", () => {
  it("retains summary, detail and final consistency evidence", async () => {
    const batch = await pollSource(source, readFixture, noDelay);
    expect(batch.pages).toHaveLength(5);
    expect(batch.jobs).toHaveLength(3);
    expect(batch.jobs[0]).toMatchObject({
      source: "breezy",
      postingId: "000000000001",
      countryCode: "NL",
      remote: "remote",
      evidence: { page: 1 },
      postedAt: "2026-10-10T12:00:00.000Z",
    });
    expect(batch.jobs[0]?.description).not.toContain("<p>");
  });
  it("accepts a stable empty list", async () => {
    const batch = await pollSource(
      source,
      read(() => "[]"),
      noDelay,
    );
    expect(batch.jobs).toEqual([]);
    expect(batch.pages).toHaveLength(2);
  });
  it.each(["tenant", "duplicate", "identity", "schema"])("rejects %s list drift", async (kind) => {
    const reader = read((body, url) => {
      if (!url.endsWith("/json")) return body;
      const jobs = JSON.parse(body);
      if (kind === "tenant") jobs[0].url = "https://other.breezy.hr/p/000000000001-synthetic-role";
      if (kind === "duplicate") jobs[1] = jobs[0];
      if (kind === "identity") jobs[0].id = "000000000009";
      return JSON.stringify(kind === "schema" ? { positions: jobs } : jobs);
    });
    await expect(pollSource(source, reader, noDelay)).rejects.toMatchObject({
      health: "parser_failed",
    });
  });
  it.each(["missing", "duplicate", "title", "tenant", "malformed"])(
    "rejects %s detail evidence",
    async (kind) => {
      const reader = read((body, url) => {
        if (url.endsWith("/json")) return body;
        if (kind === "missing") return "<html>No structured evidence</html>";
        if (kind === "duplicate") return body + body;
        if (kind === "malformed") return '<script type="application/ld+json">{bad}</script>';
        return kind === "title"
          ? body.replace("Breezy Software Engineer", "Different role")
          : body.replaceAll("synthetic-board.breezy.hr", "other.breezy.hr");
      });
      await expect(pollSource(source, reader, noDelay)).rejects.toMatchObject({
        health: "parser_failed",
      });
    },
  );
  it("does not complete a moving or oversized list", async () => {
    await expect(
      pollSource(
        source,
        read((body, url, call) => (url.endsWith("/json") && call > 1 ? "[]" : body)),
        noDelay,
      ),
    ).rejects.toMatchObject({ health: "parser_failed" });
    await expect(
      pollSource(
        source,
        read((body) => JSON.stringify(Array(199).fill(JSON.parse(body)[0]))),
        noDelay,
      ),
    ).rejects.toMatchObject({ health: "parser_failed" });
  });
  it.each([
    [403, "forbidden"],
    [429, "rate_limited"],
    [302, "unavailable"],
  ] as const)("does not follow HTTP %s", async (status, health) => {
    await expect(
      pollSource(
        source,
        read((body) => body, status),
        noDelay,
      ),
    ).rejects.toMatchObject({ health, pages: [expect.objectContaining({ status })] });
  });
  it("recognizes exact tenant URLs and refuses private routes before HTTP", async () => {
    expect(
      recognizeUrl("https://synthetic-board.breezy.hr/p/000000000001-role?source=test"),
    ).toMatchObject({ connector: "breezy", board: "synthetic-board" });
    expect(() =>
      recognizeUrl("https://synthetic-board.breezy.hr.evil.test/p/000000000001-role"),
    ).toThrow();
    await expect(readPublic("https://synthetic-board.breezy.hr/team/portal")).rejects.toMatchObject(
      { health: "unavailable" },
    );
    await expect(
      readPublic("https://synthetic-board.breezy.hr/json?secret=1"),
    ).rejects.toMatchObject({ health: "unavailable" });
  });
});
