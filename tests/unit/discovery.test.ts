import { describe, expect, it } from "vitest";
import { normalizePage, pollSource } from "../../packages/discovery/src/connectors.js";
import { parseHistory } from "../../packages/discovery/src/history.js";
import { locationFields, recognizeUrl } from "../../packages/discovery/src/normalize.js";
import { publicAddress, retryAfter } from "../../packages/discovery/src/transport.js";
import {
  greenhouseFixture,
  leverFixture,
  recruiteeFixture,
  sourceFixture,
} from "../helpers/discovery-fixtures.js";

describe("public discovery contracts", () => {
  it("normalizes typed vacancies and retains identity, source location and locators", () => {
    const { jobs } = normalizePage(greenhouseFixture(), sourceFixture, 0);
    expect(jobs[0]).toMatchObject({
      countryCode: "NL",
      city: "Amsterdam",
      remote: "unknown",
      evidence: { page: 0, locator: "jobs[0]" },
      roleFamily: "software",
    });
    expect(jobs[0]?.description).toBe("Build and test reliable synthetic services with Python.");
    expect(locationFields("Anywhere").countryCode).toBeUndefined();
    expect(locationFields("Amsterdam", "US").countryCode).toBe("US");
    const feed = greenhouseFixture([1, 2]);
    if (feed.jobs[1] && feed.jobs[0]) feed.jobs[1].internal_job_id = feed.jobs[0].internal_job_id;
    const aliases = normalizePage(feed, sourceFixture, 0).jobs;
    expect(aliases[0]?.id).toBe(aliases[1]?.id);
    expect(aliases[0]?.postingId).not.toBe(aliases[1]?.postingId);
  });
  it("traverses exact-multiple pagination including the terminal empty page", async () => {
    const requests: string[] = [];
    const result = await pollSource(
      { ...sourceFixture, connector: "lever" },
      async (url) => {
        requests.push(url);
        const from = Number(new URL(url).searchParams.get("skip"));
        return {
          status: 200,
          body: JSON.stringify(leverFixture(from, from < 200 ? 100 : 0)),
          etag: null,
          retryAfter: null,
        };
      },
      async () => undefined,
    );
    expect(result.jobs).toHaveLength(200);
    expect(requests).toHaveLength(3);
    expect(new Set(result.jobs.map((j) => j.id)).size).toBe(200);
  });
  it("normalizes one bounded Recruitee snapshot with adapter-compatible identity", async () => {
    const requests: string[] = [];
    const source = { ...sourceFixture, connector: "recruitee" as const, board: "synthetic" };
    const result = await pollSource(source, async (url) => {
      requests.push(url);
      return {
        status: 200,
        body: JSON.stringify(recruiteeFixture([7])),
        etag: null,
        retryAfter: null,
      };
    });
    expect(requests).toEqual(["https://synthetic.recruitee.com/api/offers/"]);
    expect(result.jobs[0]).toMatchObject({
      postingId: "synthetic-engineer-7",
      providerRequisition: "207",
      canonicalUrl: "https://synthetic.recruitee.com/o/synthetic-engineer-7",
      countryCode: "NL",
      city: "Rotterdam",
      remote: "hybrid",
      evidence: { page: 0, locator: "offers[0]" },
    });
    expect(result.jobs[0]?.description).toContain("operational practices");
  });
  it("rejects repeated pages and incomplete snapshots without a partial success", async () => {
    await expect(
      pollSource(
        { ...sourceFixture, connector: "lever" },
        async () => ({
          status: 200,
          body: JSON.stringify(leverFixture(0, 100)),
          etag: null,
          retryAfter: null,
        }),
        async () => undefined,
      ),
    ).rejects.toMatchObject({ health: "parser_failed" });
    expect(() =>
      normalizePage({ ...greenhouseFixture(), meta: { total: 4 } }, sourceFixture, 0),
    ).toThrow();
  });
  it("classifies public source denials, throttling and conditional revalidation", async () => {
    await expect(
      pollSource(sourceFixture, async () => ({
        status: 403,
        body: "Denied",
        etag: null,
        retryAfter: null,
      })),
    ).rejects.toMatchObject({ health: "forbidden", pages: [{ status: 403 }] });
    await expect(
      pollSource(sourceFixture, async () => ({
        status: 429,
        body: "Rate limit",
        etag: null,
        retryAfter: "120",
      })),
    ).rejects.toMatchObject({ health: "rate_limited", retryAfterMs: 120000 });
    expect(
      (
        await pollSource({ ...sourceFixture, etag: '"fixture"' }, async () => ({
          status: 304,
          body: "",
          etag: null,
          retryAfter: null,
        }))
      ).notModified,
    ).toBe(true);
    expect(retryAfter("Wed, 16 Sep 2026 10:02:00 GMT", Date.parse("2026-09-16T10:00:00Z"))).toBe(
      120000,
    );
  });
  it("canonicalizes supported tracking URLs without following arbitrary redirects", () => {
    expect(
      recognizeUrl("https://boards.greenhouse.io/synthetic-board/jobs/1?utm_source=test#apply")
        .canonicalUrl,
    ).toBe("https://job-boards.greenhouse.io/synthetic-board/jobs/1");
    expect(
      recognizeUrl("https://jobs.eu.lever.co/synthetic-board/abc-123/apply?source=test"),
    ).toMatchObject({ connector: "lever", region: "eu", postingId: "abc-123" });
    expect(
      recognizeUrl("https://synthetic.recruitee.com/o/platform-engineer?source=test#apply"),
    ).toEqual({
      connector: "recruitee",
      board: "synthetic",
      region: "global",
      postingId: "platform-engineer",
      canonicalUrl: "https://synthetic.recruitee.com/o/platform-engineer",
    });
    for (const url of [
      "http://jobs.lever.co/board/id",
      "https://jobs.lever.co@127.0.0.1/board/id",
      "https://jobs.lever.co.attacker.example/board/id",
      "https://jobs.lever.co:444/board/id",
      "https://example.com/redirect?url=https://jobs.lever.co/board/id",
      "https://synthetic.recruitee.com.attacker.example/o/platform-engineer",
    ])
      expect(() => recognizeUrl(url)).toThrow();
  });
  it("blocks private, mapped, reserved and malformed network addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
      "nonsense",
    ])
      expect(publicAddress(address)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("requires explicit historical assertions and never infers them from documents", () => {
    const record = {
      externalId: "letter-1",
      url: "https://job-boards.greenhouse.io/synthetic-board/jobs/1",
      company: "Synthetic",
      title: "Engineer",
      submitted: false,
      submittedOn: null,
      ownerAssertion: "",
      documents: [{ name: "letter.pdf", sha256: null }],
    };
    expect(parseHistory(JSON.stringify([record]), "json")[0]?.submitted).toBe(false);
    expect(() => parseHistory(JSON.stringify([{ ...record, submitted: true }]), "json")).toThrow();
    expect(
      parseHistory(
        "externalId,url,company,title,submitted,submittedOn,ownerAssertion\nlegacy-1,https://job-boards.greenhouse.io/synthetic-board/jobs/1,Synthetic,Engineer,true,2026-09-01,Owner asserts prior submission",
        "csv",
      )[0]?.submitted,
    ).toBe(true);
  });
});
