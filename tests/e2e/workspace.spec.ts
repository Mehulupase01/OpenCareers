import { expect, test } from "@playwright/test";

test("synthetic workspace, queue worker and persistent controls", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Applied AI Engineer", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("Rotterdam");
  await expect(
    page.getByRole("button", { name: "Machine Learning Engineer", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Applied AI Engineer", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("searchbox").clear();
  const pipeline = page.getByRole("region", { name: "Pipeline overview" });
  await pipeline.locator("summary").click();
  await expect(pipeline.getByText("All tracked applications", { exact: true })).toBeVisible();
  await expect(pipeline.getByText("Missing confirmation evidence", { exact: true })).toBeVisible();
  await expect(pipeline.getByText("Target remaining (synthetic)", { exact: true })).toBeVisible();
  await expect(pipeline.getByText("Inference budget", { exact: true })).toBeVisible();
  await expect(
    pipeline.getByRole("table", { name: "Daily pipeline throughput" }).getByRole("row"),
  ).toHaveCount(6);
  expect(
    await pipeline
      .getByRole("table", { name: "All application stage counts" })
      .getByRole("row")
      .count(),
  ).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Applied AI Engineer", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: `test-results/workspace-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  const discovery = page.getByRole("switch", { name: "discovery", exact: true });
  await expect(discovery).toHaveAttribute("aria-checked", "true");
  await discovery.click();
  await expect(discovery).toHaveAttribute("aria-checked", "false");
  await discovery.click();
  await expect(discovery).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Work queue", exact: true }).click();
  await page.getByRole("button", { name: "Run queue check" }).click();
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Workers", exact: true }).click();
  await expect(page.getByText("Online", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
