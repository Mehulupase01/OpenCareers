import { expect, test } from "@playwright/test";
import type { ExperimentGenerationView } from "../../packages/contracts/src/experiment-generation.js";
import { letterVariantRecipes } from "../../packages/documents/src/letter-variants.js";

// Synthetic route fixtures exercise the owner UI, not worker/model integration.
test("approved generation review, result catalog, legacy variants and refusals", async ({
  page,
}, info) => {
  const recipes = letterVariantRecipes();
  const firstRecipe = recipes[0];
  if (!firstRecipe) throw new Error("Expected public recipe catalog.");
  const { id, version, sha256 } = firstRecipe;
  const recipe = { id, version, sha256 };
  const experimentId = "10000000-0000-4000-8000-000000000001";
  const legacyId = "10000000-0000-4000-8000-000000000002";
  const definition = {
    id: experimentId,
    metric: "INTERVIEW",
    observationDays: 30,
    expiresAt: "2099-01-01T00:00:00.000Z",
    maximumAssignments: 20,
    variants: [
      { id: "focused", kind: "wording", approvalSha256: "a".repeat(64), generationRecipe: recipe },
      { id: "manual", kind: "wording", approvalSha256: "b".repeat(64) },
    ],
  };
  const catalog = [
    { ...definition, state: "active", revision: 3 },
    {
      ...definition,
      id: legacyId,
      variants: definition.variants.map(({ generationRecipe: _, ...item }) => item),
      state: "active",
      revision: 1,
    },
  ];
  let results: ExperimentGenerationView[] = [];
  let refusal = false;
  const posted: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/v1/outcomes/experiments**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      posted.push(body);
      if (refusal)
        return route.fulfill({ status: 409, json: { message: "Application revision is stale." } });
      const result: ExperimentGenerationView = {
        id: body.id,
        experimentId,
        variantId: body.variantId,
        applicationId: body.applicationId,
        assessmentId: body.assessmentId,
        recipe,
        state: "queued",
        packetId: null,
        packetSha256: null,
        critiqueSha256: null,
        repaired: null,
        failureCode: null,
        createdAt: "2026-10-14T12:00:00.000Z",
      };
      results = [result];
      return route.fulfill({ json: result });
    }
    if (path.endsWith("/generations/recipes")) return route.fulfill({ json: recipes });
    if (path.endsWith("/generations/applications"))
      return route.fulfill({
        json: [
          {
            applicationId: "synthetic-application-a",
            revision: 7,
            assessmentId: "synthetic-assessment-a",
            company: "Synthetic Co",
            title: "Engineer",
            state: "MATCHED",
          },
          {
            applicationId: "synthetic-application-b",
            revision: 2,
            assessmentId: "synthetic-assessment-b",
            company: "Synthetic Co",
            title: "Analyst",
            state: "MATCHED",
          },
        ],
      });
    if (path.endsWith("/generations"))
      return route.fulfill({ json: path.includes(legacyId) ? [] : results });
    if (path.endsWith("/packets") || path.endsWith("/assignments"))
      return route.fulfill({ json: [] });
    return route.fulfill({ json: catalog });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Outcomes", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Controlled experiments", exact: true });
  await workspace.getByLabel("Saved experiment", { exact: true }).selectOption(experimentId);
  const generation = workspace.getByRole("region", {
    name: "Approved letter generation",
    exact: true,
  });
  const enqueue = generation.getByRole("button", { name: "Enqueue letter variant", exact: true });
  const ack = generation.getByRole("checkbox");
  await generation.getByLabel("Generation variant", { exact: true }).selectOption("focused");
  await expect(generation.getByLabel("Generation variant").locator("option")).toHaveCount(2);
  await generation
    .getByLabel("Eligible application", { exact: true })
    .selectOption("synthetic-application-a");
  await expect(enqueue).toBeDisabled();
  await ack.check();
  await generation.getByLabel("Eligible application").selectOption("synthetic-application-b");
  await expect(ack).not.toBeChecked();
  await generation.getByLabel("Eligible application").selectOption("synthetic-application-a");
  await ack.check();
  await enqueue.click();
  await expect(generation.getByRole("cell", { name: "queued", exact: true })).toBeVisible();
  expect(posted[0]).toEqual({
    id: expect.any(String),
    experimentId,
    variantId: "focused",
    applicationId: "synthetic-application-a",
    assessmentId: "synthetic-assessment-a",
    expectedApplicationRevision: 7,
    expectedExperimentRevision: 3,
    reviewed: true,
  });
  await expect(ack).not.toBeChecked();
  const queued = results[0];
  if (!queued) throw new Error("Expected queued fixture.");
  results = [
    {
      ...queued,
      state: "prepared",
      packetId: "synthetic-packet",
      packetSha256: "c".repeat(64),
      critiqueSha256: "d".repeat(64),
      repaired: true,
    },
    {
      ...queued,
      id: "10000000-0000-4000-8000-000000000003",
      state: "failed",
      failureCode: "MODEL_OUTPUT_INVALID",
    },
  ];
  await generation.getByRole("button", { name: "Refresh generations" }).click();
  await expect(generation.getByRole("cell", { name: "prepared", exact: true })).toBeVisible();
  await expect(generation.getByText("MODEL_OUTPUT_INVALID")).toBeVisible();
  await expect(generation.getByRole("link", { name: "Review letter PDF" })).toHaveAttribute(
    "href",
    "/v1/documents/synthetic-packet/artifacts/letter_pdf?preview=1",
  );
  await expect(
    workspace.getByRole("button", { name: "Assign reviewed packet", exact: true }),
  ).toBeDisabled();
  refusal = true;
  await ack.check();
  await enqueue.click();
  await expect(generation.getByRole("alert")).toContainText("Application revision is stale.");
  await expect(ack).not.toBeChecked();
  expect(posted).toHaveLength(2);
  await generation.getByText("Recipe catalog", { exact: true }).click();
  await expect(generation).toContainText(sha256);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await generation
      .locator("td")
      .evaluateAll((cells) => cells.every((cell) => cell.scrollWidth <= cell.clientWidth)),
  ).toBe(true);
  await generation.screenshot({
    path: `test-results/experiment-generation-${info.project.name}.png`,
  });
  await workspace.getByLabel("Saved experiment").selectOption(legacyId);
  await expect(generation.getByText("Manual variants only", { exact: true })).toBeVisible();
  await expect(enqueue).toBeDisabled();
  await expect(
    workspace.getByLabel("Approved variant", { exact: true }).locator("option"),
  ).toHaveCount(3);
  expect(errors).toEqual([]);
});
