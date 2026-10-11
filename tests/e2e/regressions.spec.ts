import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import type { FactInput } from "../../packages/contracts/src/candidate.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { RegressionRepository } from "../../packages/persistence/src/regression-repository.js";

test("private corrections require review before sanitized fixture download", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dataDir = await mkdtemp(join(tmpdir(), "opencareers-regression-browser-"));
  const db = await openSqlite(":memory:");
  const owner = `regression-browser-${randomUUID()}`;
  const candidate = new CandidateRepository(db, owner);
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    await migrate(db);
    await candidate.initialize();
    const input = {
      key: "employment.synthetic",
      expectedRevision: 0,
      value: {
        kind: "employment",
        employer: "Synthetic Private Employer Sentinel",
        title: "Synthetic Private Role Sentinel",
        start: "2025-01",
        end: "2025-12",
        workload: "full_time",
        description: "synthetic-private@sentinel.invalid",
      },
      provenance: { kind: "owner", statement: "Synthetic Private Provenance Sentinel" },
      expiresOn: null,
    } satisfies FactInput;
    const original = await candidate.saveFact(input);
    const verified = await candidate.reviewFact(original.id, original.revision, "verified");
    const edited = await candidate.saveFact({
      ...input,
      id: original.id,
      expectedRevision: verified.revision,
      value: { ...input.value, workload: "part_time" },
    });
    await candidate.reviewFact(edited.id, edited.revision, "verified");
    const proposals = new RegressionRepository(db, owner);
    const item = (await proposals.list())[0];
    if (!item) throw new Error("Expected captured correction.");
    const token = randomUUID();
    app = await buildServer(
      {
        ...loadConfig({}),
        profile: "demo",
        dataDir,
        ownerToken: token,
        allowedOrigins: ["http://127.0.0.1:4318"],
      },
      candidate,
    );
    const isolatedApi = app;
    await page.route("**/v1/outcomes/regressions**", async (route) => {
      const incoming = route.request();
      const response = await isolatedApi.inject({
        method: incoming.method() as "GET" | "POST",
        url: new URL(incoming.url()).pathname,
        headers: {
          host: "127.0.0.1:4317",
          origin: "http://127.0.0.1:4318",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        ...(incoming.postData() ? { payload: incoming.postData() as string } : {}),
      });
      await route.fulfill({
        status: response.statusCode,
        contentType: "application/json",
        body: response.body,
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Outcomes", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Regression proposals" });
    await expect(
      workspace.getByRole("cell", { name: "full_time to part_time", exact: true }),
    ).toBeVisible();
    await expect(workspace).not.toContainText("Sentinel");
    await expect(
      workspace.getByRole("button", { name: `Approve regression ${item.id}`, exact: true }),
    ).toBeDisabled();
    await expect(
      workspace.getByRole("button", { name: `Export regression ${item.id}`, exact: true }),
    ).toBeDisabled();
    await workspace.getByLabel(`Reviewed regression ${item.id}`, { exact: true }).check();
    await workspace
      .getByRole("button", { name: `Approve regression ${item.id}`, exact: true })
      .click();
    await expect(workspace.getByRole("cell", { name: "approved / 2", exact: true })).toBeVisible();
    await expect(
      workspace.getByLabel(`Reviewed regression ${item.id}`, { exact: true }),
    ).toBeChecked();
    const downloaded = page.waitForEvent("download");
    await workspace
      .getByRole("button", { name: `Export regression ${item.id}`, exact: true })
      .click();
    const download = await downloaded;
    const path = await download.path();
    if (!path) throw new Error("Expected regression download.");
    const bytes = await readFile(path);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
    expect(JSON.parse(bytes.toString())).toEqual(item.fixture);
    expect(bytes.toString()).not.toMatch(/Sentinel|sentinel.invalid|employment.synthetic/);
    expect(bytes.toString()).not.toContain(original.id);
    await page.reload();
    await page.getByRole("button", { name: "Outcomes", exact: true }).click();
    await expect(workspace.getByRole("cell", { name: "approved / 2", exact: true })).toBeVisible();
    await expect(
      workspace.getByRole("button", { name: `Approve regression ${item.id}`, exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const rowBounds = await workspace.locator("tbody tr").first().boundingBox();
    expect(rowBounds?.height).toBeLessThan(100);
    await workspace.screenshot({ path: `test-results/regression-table-${info.project.name}.png` });
    await page.screenshot({
      path: `test-results/regressions-${info.project.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
