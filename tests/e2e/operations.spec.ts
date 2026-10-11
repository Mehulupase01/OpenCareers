import { expect, test } from "@playwright/test";
import { makeJson } from "../helpers/browser-setup.js";

test.afterEach(async ({ page }) => {
  if (page.url() !== "about:blank") await makeJson(page)("/v1/control/resume", {});
});

test("emergency stop persists across reload and resume keeps submissions paused", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Stop processing", exact: true })).toBeVisible();
  const json = makeJson(page);
  const before = (await json("/v1/operations/summary")).control;
  await page.getByRole("button", { name: "Stop processing", exact: true }).click();
  await expect(
    page.getByText("Already-sent requests cannot be recalled.", { exact: true }),
  ).toBeVisible();
  const stopped = (await json("/v1/operations/summary")).control;
  expect(stopped).toMatchObject({ ...before, stopped: true, submissionsPaused: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(
    page.getByText("Already-sent requests cannot be recalled.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/emergency-stop-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByText("Already-sent requests cannot be recalled.", { exact: true }),
  ).toHaveCount(0);
  expect((await json("/v1/operations/summary")).control).toMatchObject({
    ...before,
    stopped: false,
    submissionsPaused: true,
  });
});

test("daily shortfall keeps uncertain attempts out of confirmations", async ({ page }) => {
  // Inject only the readout fixture; no application, intent or submission is created.
  await page.route("**/v1/operations/summary", async (route) => {
    const response = await route.fetch();
    const summary = await response.json();
    summary.counts.unknown = 1;
    summary.daily.target = 12;
    summary.daily.cohorts.synthetic.attemptsStarted = 1;
    summary.daily.cohorts.synthetic.dispatchesStarted = 1;
    summary.daily.cohorts.synthetic.confirmedApplications = 0;
    summary.flow.states = [{ state: "UNKNOWN", count: 1 }];
    summary.flow.confirmedWithReceipt = 0;
    await route.fulfill({ response, json: summary });
  });
  await page.goto("/");
  const pipeline = page.getByRole("region", { name: "Pipeline overview" });
  await pipeline.locator("summary").click();
  await expect(
    pipeline
      .locator("dl div")
      .filter({ has: page.getByText("Target remaining (synthetic)", { exact: true }) })
      .locator("dd"),
  ).toHaveText("12");
  const daily = pipeline.getByRole("table", { name: "Daily pipeline throughput" });
  await expect(
    daily.getByRole("row").filter({ hasText: "Attempts started" }).getByRole("cell"),
  ).toHaveText(["Attempts started", "0", "1"]);
  await expect(
    daily.getByRole("row").filter({ hasText: "Receipt-backed confirmations" }).getByRole("cell"),
  ).toHaveText(["Receipt-backed confirmations", "0", "0"]);
  await expect(
    pipeline
      .getByRole("table", { name: "All application stage counts" })
      .getByRole("cell", { name: "unknown", exact: true }),
  ).toBeVisible();
  expect(await daily.evaluate((table) => table.scrollWidth <= table.clientWidth)).toBe(true);
});
