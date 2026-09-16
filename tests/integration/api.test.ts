import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

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
