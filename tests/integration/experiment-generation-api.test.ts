import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { letterVariantRecipes } from "../../packages/documents/src/letter-variants.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

it("authenticates generation routes and rejects unreviewed or caller-directed generation", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "opencareers-generation-api-"));
  const db = await openSqlite(":memory:");
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    await migrate(db);
    const repository = new Repository(db, `generation-api-${randomUUID()}`);
    await repository.initialize();
    const token = "a".repeat(32);
    app = await buildServer(
      { ...loadConfig({}), profile: "local", dataDir, ownerToken: token },
      repository,
    );
    const endpoint = "/v1/outcomes/experiments";
    const experimentId = randomUUID();
    const headers = { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4318" };
    const authorized = { ...headers, authorization: `Bearer ${token}` };
    const payload = {
      id: randomUUID(),
      experimentId,
      variantId: "focused",
      applicationId: "synthetic-application",
      assessmentId: "synthetic-assessment",
      expectedApplicationRevision: 1,
      expectedExperimentRevision: 1,
      reviewed: true,
    };
    for (const url of [
      `${endpoint}/generations/recipes`,
      `${endpoint}/generations/applications`,
      `${endpoint}/${experimentId}/generations`,
    ]) {
      expect((await app.inject({ url, headers })).statusCode).toBe(401);
    }
    expect(
      (await app.inject({ method: "POST", url: `${endpoint}/generations`, headers, payload }))
        .statusCode,
    ).toBe(401);
    const recipes = await app.inject({
      url: `${endpoint}/generations/recipes`,
      headers: authorized,
    });
    expect(recipes.statusCode).toBe(200);
    expect(recipes.json()).toEqual(letterVariantRecipes());
    expect(
      (
        await app.inject({ url: `${endpoint}/generations/applications`, headers: authorized })
      ).json(),
    ).toEqual([]);
    for (const invalid of [
      { ...payload, reviewed: false },
      { ...payload, prompt: "arbitrary instruction" },
      { ...payload, recipe: letterVariantRecipes()[0] },
      { ...payload, expectedApplicationRevision: 0 },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `${endpoint}/generations`,
            headers: authorized,
            payload: invalid,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (await app.inject({ url: `${endpoint}/not-a-uuid/generations`, headers: authorized }))
        .statusCode,
    ).toBe(400);
  } finally {
    await app?.close();
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
