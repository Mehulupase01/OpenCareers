import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { MATCHING_PIPELINE_VERSION } from "../../packages/matching/src/domain.js";
import { CalibrationRepository } from "../../packages/persistence/src/calibration-repository.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { documentAssessment, documentJob, documentProfile } from "../fixtures/document-packets.js";
import { makeJson } from "../helpers/browser-setup.js";

test("fixed review import is bounded, owner-confirmed and readable after reload", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dataDir = await mkdtemp(join(tmpdir(), "opencareers-calibration-browser-"));
  const db = await openSqlite(":memory:");
  const owner = `calibration-browser-${randomUUID()}`;
  const repository = new Repository(db, owner);
  const calibration = new CalibrationRepository(db, owner);
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    await migrate(db);
    await repository.initialize();
    await repository.putJob(documentJob);
    await db.query(
      "INSERT INTO profile_versions(id,owner_id,candidate_id,revision,data,created_at) VALUES($1,$2,'synthetic-candidate',1,'{}',$3)",
      [documentProfile.id, owner, documentAssessment.createdAt],
    );
    const assessment = {
      ...documentAssessment,
      id: randomUUID(),
      applicationId: null,
      pipelineVersion: MATCHING_PIPELINE_VERSION,
    };
    const data = JSON.stringify(assessment);
    await db.query(
      "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,revision,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        owner,
        assessment.id,
        assessment.jobId,
        assessment.profileId,
        assessment.revision,
        data,
        createHash("sha256").update(data).digest("hex"),
        assessment.createdAt,
      ],
    );
    const token = randomUUID();
    app = await buildServer(
      {
        ...loadConfig({}),
        profile: "demo",
        dataDir,
        ownerToken: token,
        allowedOrigins: ["http://127.0.0.1:4318"],
      },
      repository,
    );
    const isolatedApi = app;
    // Production handlers and migrations, but private test state; no shared candidate/source writes.
    await page.route("**/v1/outcomes/calibration/datasets**", async (route) => {
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
    await expect(page.getByText("No real applications submitted")).toBeVisible();
    const json = makeJson(page);
    const before = await json("/v1/operations/summary");
    const dataset = {
      id: randomUUID(),
      from: assessment.createdAt,
      through: before.asOf,
      labels: [
        {
          assessmentId: assessment.id,
          relevant: true,
          reviewedAt: before.asOf,
          evidenceRef: "synthetic-browser-review",
          evidenceSha256: "a".repeat(64),
        },
      ],
    };
    await page.getByRole("button", { name: "Outcomes", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Relevance diagnostics" });
    const file = workspace.getByLabel("Review dataset", { exact: true });
    await expect(file).toBeEnabled();
    await file.setInputFiles({
      name: "private-shaped.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...dataset, candidate: "PRIVATE-SENTINEL" })),
    });
    await expect(workspace.getByRole("alert")).toHaveText("Invalid fixed review dataset.");
    await expect(workspace).not.toContainText("PRIVATE-SENTINEL");
    await file.setInputFiles({
      name: "oversized.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(120 * 1024 + 1, " "),
    });
    await expect(workspace.getByRole("alert")).toHaveText("Review file exceeds 120 KiB.");
    await file.setInputFiles({
      name: "review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(dataset)),
    });
    const save = workspace.getByRole("button", { name: "Save fixed dataset", exact: true });
    await expect(save).toBeDisabled();
    await workspace.getByLabel("Owner-reviewed relevance labels", { exact: true }).check();
    await save.click();
    await expect(
      workspace.getByRole("heading", { name: "Insufficient reviewed data" }),
    ).toBeVisible();
    await expect(workspace.getByRole("status")).toContainText("Excluded synthetic");
    await expect(workspace.getByRole("status")).toContainText(MATCHING_PIPELINE_VERSION);
    await expect(workspace.getByRole("status")).toContainText("not employer outcomes");
    await expect(workspace.getByText("Relevance discrimination AUC", { exact: true })).toHaveCount(
      0,
    );
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeEnabled();
    expect(
      (await calibration.list()).filter((item: { id: string }) => item.id === dataset.id),
    ).toHaveLength(1);
    await page.reload();
    await page.getByRole("button", { name: "Outcomes", exact: true }).click();
    await expect(workspace.getByLabel("Saved dataset", { exact: true })).toBeEnabled();
    await workspace.getByLabel("Saved dataset", { exact: true }).selectOption(dataset.id);
    await workspace.getByRole("button", { name: "Open diagnostics", exact: true }).click();
    await expect(
      workspace.getByRole("heading", { name: "Insufficient reviewed data" }),
    ).toBeVisible();
    const after = await json("/v1/operations/summary");
    await expect(workspace.getByRole("status")).toContainText(MATCHING_PIPELINE_VERSION);
    expect(after.control).toEqual(before.control);
    expect(after.applications.map((a: { id: string; state: string }) => [a.id, a.state])).toEqual(
      before.applications.map((a: { id: string; state: string }) => [a.id, a.state]),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/calibration-${info.project.name}.png`,
      fullPage: true,
    });
    // Presentation-only fixture, not a live quality measurement or stored corpus.
    const refusal = await calibration.report(dataset.id);
    await page.route(`**/v1/outcomes/calibration/datasets/${dataset.id}`, (route) =>
      route.fulfill({
        json: {
          ...refusal,
          status: "measured",
          sampleSize: 20,
          relevant: 10,
          irrelevant: 10,
          metrics: { spearmanRankCorrelation: 0.75, relevanceDiscriminationAuc: 0.875 },
          bands: [
            { lowerInclusive: 0, upperExclusive: 40, sampleSize: 10, relevant: 2 },
            { lowerInclusive: 40, upperExclusive: 70, sampleSize: 5, relevant: 3 },
            { lowerInclusive: 70, upperExclusive: 101, sampleSize: 5, relevant: 5 },
          ],
          exclusions: { synthetic: 0 },
        },
      }),
    );
    await workspace.getByRole("button", { name: "Open diagnostics", exact: true }).click();
    await expect(
      workspace.getByRole("heading", { name: "Fixed relevance diagnostics" }),
    ).toBeVisible();
    await expect(workspace.getByRole("status")).toContainText("0.875");
    await expect(
      workspace.getByRole("columnheader", { name: "Fit band", exact: true }),
    ).toBeVisible();
    await expect(workspace.getByRole("cell", { name: "70 to 100", exact: true })).toBeVisible();
    await expect(workspace.getByRole("status")).not.toContainText(/probability|chance of hire/i);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/calibration-measured-fixture-${info.project.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
