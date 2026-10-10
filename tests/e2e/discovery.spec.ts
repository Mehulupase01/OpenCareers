import { expect, test } from "@playwright/test";

test("Breezy public source shows structured evidence and discovery-only support", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add discovery source" });
  await editor.getByRole("combobox", { name: "Connector", exact: true }).selectOption("breezy");
  await expect(editor.getByRole("combobox", { name: "Region", exact: true })).toBeDisabled();
  await editor.getByLabel("Board token", { exact: true }).fill("synthetic-breezy-e2e");
  await editor.getByLabel("Company", { exact: true }).fill("Synthetic Breezy Employer");
  await editor.getByLabel("Employer ID", { exact: true }).fill("synthetic-breezy-employer");
  await editor.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    page.locator(".source-health-list article").filter({ hasText: "synthetic-breezy-e2e" }),
  ).toContainText("3 postings", { timeout: 25000 });
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await expect(
    page
      .locator(".coverage-table tbody tr")
      .filter({ hasText: "Public tenant list and structured vacancy pages" }),
  ).toContainText("planned / planned");
  await page.screenshot({ path: `test-results/breezy-${info.project.name}.png`, fullPage: true });
});

test("Teamtailor paginated RSS source shows discovery-only support", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add discovery source" });
  await editor.getByRole("combobox", { name: "Connector", exact: true }).selectOption("teamtailor");
  await expect(editor.getByRole("combobox", { name: "Region", exact: true })).toBeDisabled();
  await editor.getByLabel("Board token", { exact: true }).fill("synthetic-teamtailor-e2e");
  await editor.getByLabel("Company", { exact: true }).fill("Synthetic Teamtailor Employer");
  await editor.getByLabel("Employer ID", { exact: true }).fill("synthetic-teamtailor-employer");
  await editor.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const source = page
    .locator(".source-health-list article")
    .filter({ hasText: "synthetic-teamtailor-e2e" });
  await expect(source).toContainText("healthy", { timeout: 25000 });
  await expect(source).toContainText("3 postings");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await expect(
    page.locator(".coverage-table tbody tr").filter({ hasText: "Paginated public tenant RSS" }),
  ).toContainText("planned / planned");
  await page.screenshot({
    path: `test-results/teamtailor-${info.project.name}.png`,
    fullPage: true,
  });
});

test("Workable public source retains redirect evidence and discovery-only support", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add discovery source" });
  await editor.getByRole("combobox", { name: "Connector", exact: true }).selectOption("workable");
  await expect(editor.getByRole("combobox", { name: "Region", exact: true })).toBeDisabled();
  await editor.getByLabel("Board token", { exact: true }).fill("synthetic-workable-e2e");
  await editor.getByLabel("Company", { exact: true }).fill("Synthetic Workable Employer");
  await editor.getByLabel("Employer ID", { exact: true }).fill("synthetic-workable-employer");
  await editor.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const source = page
    .locator(".source-health-list article")
    .filter({ hasText: "synthetic-workable-e2e" });
  await expect(source).toContainText("healthy", { timeout: 25000 });
  await expect(source).toContainText("3 postings");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await expect(
    page
      .locator(".coverage-table tbody tr")
      .filter({ hasText: "Published account feed with descriptions" }),
  ).toContainText("planned / planned");
  await page.screenshot({ path: `test-results/workable-${info.project.name}.png`, fullPage: true });
});

test("SmartRecruiters source combines public summaries and descriptions without application support", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add discovery source" });
  await editor
    .getByRole("combobox", { name: "Connector", exact: true })
    .selectOption("smartrecruiters");
  await expect(editor.getByRole("combobox", { name: "Region", exact: true })).toBeDisabled();
  await editor.getByLabel("Board token", { exact: true }).fill("synthetic-smartrecruiters-e2e");
  await editor.getByLabel("Company", { exact: true }).fill("Synthetic SmartRecruiters Employer");
  await editor
    .getByLabel("Employer ID", { exact: true })
    .fill("synthetic-smartrecruiters-employer");
  await editor.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const source = page
    .locator(".source-health-list article")
    .filter({ hasText: "synthetic-smartrecruiters-e2e" });
  await expect(source).toContainText("healthy", { timeout: 25000 });
  await expect(source).toContainText("3 postings");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  const variant = page
    .locator(".coverage-table tbody tr")
    .filter({ hasText: "Public paginated postings plus descriptions" });
  await expect(variant).toContainText("planned / planned");
  await page.screenshot({
    path: `test-results/smartrecruiters-${info.project.name}.png`,
    fullPage: true,
  });
});

test("Personio XML source retains discovery-only support in the owned workflow", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add discovery source" });
  await editor.getByRole("combobox", { name: "Connector", exact: true }).selectOption("personio");
  await editor.getByRole("combobox", { name: "Region", exact: true }).selectOption("eu");
  await editor.getByLabel("Board token", { exact: true }).fill("synthetic-personio-e2e");
  await editor.getByLabel("Company", { exact: true }).fill("Synthetic Personio Employer");
  await editor.getByLabel("Employer ID", { exact: true }).fill("synthetic-personio-employer");
  await expect(editor.getByLabel("Poll interval (minutes)", { exact: true })).toHaveValue("20");
  await editor.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const source = page
    .locator(".source-health-list article")
    .filter({ hasText: "synthetic-personio-e2e" });
  await expect(source).toContainText("healthy", { timeout: 25000 });
  await expect(source).toContainText("3 postings");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  const variant = page
    .locator(".coverage-table tbody tr")
    .filter({ hasText: "Enabled public XML job feed" });
  await expect(variant).toContainText("planned / planned");
  await page.screenshot({ path: `test-results/personio-${info.project.name}.png`, fullPage: true });
});

test("Ashby source runs through the owned discovery workflow without claiming application support", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add discovery source" });
  await editor.getByRole("combobox", { name: "Connector", exact: true }).selectOption("ashby");
  await expect(editor.getByRole("combobox", { name: "Region", exact: true })).toBeDisabled();
  await editor.getByLabel("Board token", { exact: true }).fill("synthetic-ashby-e2e");
  await editor.getByLabel("Company", { exact: true }).fill("Synthetic Ashby Employer");
  await editor.getByLabel("Employer ID", { exact: true }).fill("synthetic-ashby-employer");
  await editor.getByLabel("Poll interval (minutes)", { exact: true }).fill("20");
  await editor.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const source = page
    .locator(".source-health-list article")
    .filter({ hasText: "synthetic-ashby-e2e" });
  await expect(source).toContainText("healthy", { timeout: 25000 });
  await expect(source).toContainText("3 postings");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  const variant = page
    .locator(".coverage-table tbody tr")
    .filter({ hasText: "Published listed job-board snapshot" });
  await expect(variant).toContainText("planned / planned");
  await page.screenshot({ path: `test-results/ashby-${info.project.name}.png`, fullPage: true });
});

test("discovery source, evidence, historical import and reversible identity", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Variant support" })).toBeVisible();
  const adyen = page
    .locator(".coverage-table tbody tr")
    .filter({ hasText: "Adyen hosted external form" });
  await expect(adyen).toContainText("required");
  await expect(adyen).toContainText("planned / planned");
  await page.screenshot({
    path: `test-results/discovery-coverage-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Owner-source sessions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import source session", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Scoped session JSON", { exact: true })).toBeDisabled();
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
  await page
    .locator(".vacancy-table tbody tr")
    .filter({ hasText: "greenhouse" })
    .getByRole("button", { name: "Inspect Software Engineer 1", exact: true })
    .click();
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
  const fromOption = sourceVacancy.getByRole("option", {
    name: "Synthetic Employer: Software Engineer 3 (3)",
    exact: true,
  });
  await expect(fromOption).toHaveCount(1);
  await sourceVacancy.selectOption((await fromOption.getAttribute("value")) as string);
  const canonicalVacancy = page.getByRole("combobox", { name: "Canonical vacancy", exact: true });
  const toOption = canonicalVacancy.getByRole("option", {
    name: "Synthetic Employer: Software Engineer 2 (2)",
    exact: true,
  });
  await expect(toOption).toHaveCount(1);
  await canonicalVacancy.selectOption((await toOption.getAttribute("value")) as string);
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
