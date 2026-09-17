import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { identity } from "../helpers/candidate-fixtures.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function setup() {
  const db = await openSqlite(":memory:");
  cleanup.push(() => db.close());
  await migrate(db);
  const repository = new Repository(db, "synthetic-owner");
  await repository.initialize();
  const app = await buildServer(loadConfig({}), repository);
  cleanup.push(() => app.close());
  const headers = { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4318" };
  return { db, app, headers, repository };
}

describe("API trust boundary", () => {
  it("protects candidate reads, writes and uploads and rejects oversized input", async () => {
    const { app, headers } = await setup();
    for (const url of [
      "/v1/candidate",
      "/v1/candidate/sources/unknown",
      "/v1/candidate/authorization/export",
    ])
      expect((await app.inject({ url, headers })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/v1/candidate/facts", headers, payload: identity }))
        .statusCode,
    ).toBe(401);
    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    const authenticated = { ...headers, cookie: `opencareers=${login.cookies[0]?.value}` };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/candidate/facts",
          headers: { ...authenticated, origin: "https://attacker.example" },
          payload: identity,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/candidate/facts",
          headers: authenticated,
          payload: { ...identity, unexpected: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/candidate/facts",
          headers: authenticated,
          payload: identity,
        })
      ).statusCode,
    ).toBe(200);
    const payload = Buffer.concat([
      Buffer.from(
        '--synthetic-boundary\r\nContent-Disposition: form-data; name="file"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
      ),
      Buffer.alloc(10 * 1024 * 1024 + 1, 65),
      Buffer.from("\r\n--synthetic-boundary--\r\n"),
    ]);
    const oversized = await app.inject({
      method: "POST",
      url: "/v1/candidate/sources",
      headers: {
        ...authenticated,
        "content-type": "multipart/form-data; boundary=synthetic-boundary",
      },
      payload,
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().code).toBe("CONFIG_INVALID");
  });
  it("protects discovery configuration, URL recognition and history previews", async () => {
    const { app, headers } = await setup();
    expect((await app.inject({ url: "/v1/discovery", headers })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/matching", headers })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    const authenticated = { ...headers, cookie: `opencareers=${login.cookies[0]?.value}` };
    const matching = await app.inject({ url: "/v1/matching", headers: authenticated });
    expect(matching.statusCode).toBe(200);
    expect(matching.json()).toMatchObject({
      route: { status: "unconfigured", modelId: null, provider: null },
      budget: { limit: 40, used: 0, reserved: 0 },
      assessments: [],
    });
    expect(matching.body).not.toContain("API_KEY");
    const source = {
      expectedRevision: 0,
      connector: "greenhouse",
      board: "synthetic-api",
      region: "global",
      employerId: "synthetic-employer",
      company: "Synthetic Employer",
      intervalSeconds: 300,
      enabled: true,
      mode: "fixture",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/discovery/sources",
          headers: authenticated,
          payload: { ...source, mode: "live" },
        })
      ).statusCode,
    ).toBe(409);
    const created = await app.inject({
      method: "POST",
      url: "/v1/discovery/sources",
      headers: authenticated,
      payload: source,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ board: "synthetic-api", mode: "fixture" });
    const recognized = await app.inject({
      method: "POST",
      url: "/v1/discovery/recognize",
      headers: authenticated,
      payload: { url: "https://boards.greenhouse.io/synthetic-api/jobs/123?tracking=test" },
    });
    expect(recognized.json()).toMatchObject({
      board: "synthetic-api",
      postingId: "123",
      canonicalUrl: "https://job-boards.greenhouse.io/synthetic-api/jobs/123",
    });
    const record = {
      externalId: "synthetic-api-history",
      url: "https://boards.greenhouse.io/synthetic-api/jobs/123",
      company: "Synthetic Employer",
      title: "Software Engineer",
      location: "Amsterdam",
      submitted: false,
      submittedOn: null,
      ownerAssertion: "",
      documents: [{ name: "synthetic-letter.pdf", sha256: null }],
    };
    const preview = await app.inject({
      method: "POST",
      url: "/v1/discovery/history",
      headers: authenticated,
      payload: { format: "json", content: JSON.stringify([record]), preview: true },
    });
    expect(preview.json()).toMatchObject({ count: 1, records: [record] });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/discovery/sources",
          headers: { ...authenticated, origin: "https://attacker.example" },
          payload: source,
        })
      ).statusCode,
    ).toBe(403);
  });
  it("rejects foreign hosts, foreign origins and unauthenticated data requests", async () => {
    const { app, headers } = await setup();
    expect(
      (await app.inject({ url: "/health/live", headers: { host: "attacker.example" } })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/session",
          headers: { ...headers, origin: "https://attacker.example" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: "/v1/operations/summary", headers })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/session",
          headers: { host: headers.host },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it("creates a protected demo session, applies controls and invalidates sign-out", async () => {
    const { app, headers, db } = await setup();
    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    expect(login.statusCode).toBe(200);
    expect(login.cookies[0]).toMatchObject({ name: "opencareers", httpOnly: true });
    const cookie = `opencareers=${login.cookies[0]?.value}`;
    expect(
      (await app.inject({ url: "/v1/operations/summary", headers: { ...headers, cookie } })).json()
        .counts.confirmed,
    ).toBe(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/control/stop",
          headers: { ...headers, cookie },
        })
      ).json().stopped,
    ).toBe(true);
    expect(
      (await db.query("SELECT actor,revision FROM audit_events WHERE action='control.stopped'"))[0],
    ).toEqual({ actor: "owner:synthetic-owner", revision: 1 });
    await app.inject({ method: "DELETE", url: "/v1/session", headers: { ...headers, cookie } });
    expect(
      (await app.inject({ url: "/v1/operations/summary", headers: { ...headers, cookie } }))
        .statusCode,
    ).toBe(401);
  });
  it("readiness fails when required persistence is unavailable", async () => {
    const { app, headers, db } = await setup();
    expect((await app.inject({ url: "/health/ready", headers })).statusCode).toBe(200);
    await db.query("DROP TABLE schema_migrations");
    expect((await app.inject({ url: "/health/ready", headers })).statusCode).toBe(503);
  });
});
