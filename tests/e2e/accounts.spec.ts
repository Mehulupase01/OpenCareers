import { expect, test } from "@playwright/test";

test("employer accounts prepare locally and refuse an external dispatch until authorized", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  // The shell loads the operations summary, discovery, matching and documents
  // before it renders. A 5 second default is not a realistic expectation here.
  await expect(page.getByText("No real applications submitted")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  const panel = page.getByRole("region", { name: "Employer accounts" });
  await expect(panel).toBeVisible({ timeout: 30000 });

  const origin = `https://careers.accounts-${info.project.name}.example`;
  await panel.getByLabel("Employer origin").fill(origin);
  await panel.getByLabel("Adapter").fill("synthetic-signup");
  await panel.getByLabel("Identity email").fill("alex@synthetic.example");
  await panel.getByRole("button", { name: "Prepare account" }).click();

  const row = panel.locator(".account-list li").filter({ hasText: origin });
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toHaveAttribute("data-account-state", "prepared");
  await expect(row.getByText("Credentials stored, signup not dispatched")).toBeVisible();
  await expect(row.getByText("sealed in the vault")).toBeVisible();

  // The generated password is never rendered and the identity is only ever shown
  // as a truncated digest. A 32-byte credential would surface as a long opaque
  // token, so the row must contain no such run at all.
  await expect(row).not.toContainText("alex@synthetic.example");
  expect(await row.locator(".account-meta").innerText()).toContain("...");
  const longOpaque = (await row.innerHTML()).match(/[A-Za-z0-9_-]{24,}/g) ?? [];
  expect(longOpaque).toEqual([]);

  // A demo profile can only ever write to the bundled mock ATS, so the dispatch
  // is refused by the server with an actionable reason rather than silently doing
  // nothing.
  await row.getByRole("button", { name: "Create the account" }).click();
  await expect(panel.getByRole("alert")).toBeVisible({ timeout: 20000 });
  await expect(panel.getByRole("alert")).toContainText(/external submission|vault key/i);
  await expect(row).toHaveAttribute("data-account-state", "prepared");

  // Preparing the same employer again is idempotent rather than a second account.
  const before = await panel.locator(".account-list li").count();
  await panel.getByLabel("Employer origin").fill(origin);
  await panel.getByLabel("Adapter").fill("synthetic-signup");
  await panel.getByLabel("Identity email").fill("alex@synthetic.example");
  await panel.getByRole("button", { name: "Prepare account" }).click();
  await expect.poll(async () => panel.locator(".account-list li").count()).toBe(before);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `test-results/P10-accounts-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
