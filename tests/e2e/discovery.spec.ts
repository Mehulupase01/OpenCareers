import { expect, test } from "@playwright/test";

test("discovery source, evidence, historical import and reversible identity", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Source health" })).toBeVisible();
  const existing = page.locator(".source-health-list article").filter({ hasText: "synthetic-e2e" });
  if (!(await existing.count())) {
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Add discovery source" });
    await editor.getByLabel("Board token", { exact: true }).fill("synthetic-e2e");
    await editor.getByRole("button", { name: "Add source", exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  await expect(existing).toContainText("healthy", { timeout: 25000 });
  await existing.getByRole("button", { name: "Pause Synthetic Employer", exact: true }).click();
  await expect(existing).toContainText("Paused");
  await existing.getByRole("button", { name: "Enable Synthetic Employer", exact: true }).click();
  await expect(existing).toContainText("healthy");
  await page.screenshot({
    path: `test-results/discovery-sources-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Vacancies", exact: true }).click();
  await page.getByRole("button", { name: "Inspect Software Engineer 1", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Vacancy evidence" });
  await expect(detail).toContainText("Fixture vacancy only.");
  await detail.getByRole("button", { name: "Source evidence", exact: true }).click();
  await expect(detail).toContainText("SHA-256");
  await expect(detail).toContainText("boards-api.greenhouse.io");
  await page.screenshot({
    path: `test-results/discovery-evidence-${info.project.name}.png`,
    fullPage: true,
  });
  await detail.getByRole("button", { name: "Close vacancy evidence" }).click();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  const records = [
    {
      externalId: `synthetic-history-${info.project.name}`,
      url: "https://boards.greenhouse.io/synthetic-e2e/jobs/1",
      company: "Synthetic Employer",
      title: "Software Engineer 1",
      location: "Amsterdam",
      submitted: true,
      submittedOn: "2026-09-01",
      ownerAssertion: "Synthetic owner asserts this prior submission.",
      documents: [{ name: "synthetic-letter.pdf", sha256: null }],
    },
  ];
  await page.getByLabel("History file", { exact: true }).setInputFiles({
    name: "synthetic-history.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(records)),
  });
  await expect(page.getByRole("heading", { name: "Import preview: 1 records" })).toBeVisible();
  await page.getByRole("button", { name: "Import records", exact: true }).click();
  await expect(
    page
      .locator(".answer-list article")
      .filter({ hasText: `synthetic-history-${info.project.name}` }),
  ).toContainText("Linked vacancy");
  await page.getByRole("tab", { name: "Identity", exact: true }).click();
  const activeResolution = page.locator(".answer-list article").filter({ hasText: "Merged" });
  if (await activeResolution.count()) {
    const split = activeResolution.first().getByRole("button", {
      name: "Split requisitions",
      exact: true,
    });
    await split.click();
    await expect(split).toBeDisabled();
  }
  const sourceVacancy = page.getByRole("combobox", { name: "Source vacancy", exact: true });
  await expect(sourceVacancy.locator("option")).toHaveCount(4);
  await sourceVacancy.selectOption({ index: 3 });
  const canonicalVacancy = page.getByRole("combobox", { name: "Canonical vacancy", exact: true });
  await expect(canonicalVacancy.locator("option")).toHaveCount(4);
  await canonicalVacancy.selectOption({ index: 2 });
  const identityEvidence = `Synthetic ${info.project.name} reversible identity check ${Date.now()}.`;
  await page.getByLabel("Identity evidence", { exact: true }).fill(identityEvidence);
  await page.getByRole("button", { name: "Confirm same requisition", exact: true }).click();
  const resolution = page.locator(".answer-list article").filter({ hasText: identityEvidence });
  await expect(resolution).toContainText("Merged");
  await resolution.getByRole("button", { name: "Split requisitions", exact: true }).click();
  await expect(
    resolution.getByRole("button", { name: "Split requisitions", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
