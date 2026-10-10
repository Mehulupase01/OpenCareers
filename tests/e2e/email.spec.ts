import { expect, test } from "@playwright/test";

test("mailbox stays disconnected and private credentials are unavailable in demo", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  await page.getByRole("button", { name: "Mailbox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Gmail", exact: true })).toBeVisible();
  await expect(page.getByText("unconfigured", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sync", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Credentials JSON path", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save credentials", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `test-results/mailbox-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Applications", exact: true }).click();
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  expect(errors).toEqual([]);
});
