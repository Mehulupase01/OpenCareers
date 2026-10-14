import { expect, test } from "@playwright/test";
import type { EmployerAccount } from "../../packages/contracts/src/account.js";

test("locked-account recovery collects an explicit review and clears replacement credentials", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = "https://careers.owner-reviewed-synthetic-employer.example";
  let account: EmployerAccount = {
    id: "2e7242ca-9819-471f-a66c-c14856b4cf69",
    candidateId: "synthetic-candidate",
    employerOrigin: origin,
    adapterId: "synthetic-signup",
    identityEmailHash: "a".repeat(64),
    state: "locked",
    hasCredential: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const reviews: Record<string, unknown>[] = [];
  await page.route("**/v1/accounts", (route) => route.fulfill({ json: [account] }));
  await page.route(`**/v1/accounts/${account.id}/recovery`, async (route) => {
    const input = route.request().postDataJSON();
    reviews.push(input);
    account = {
      ...account,
      state: input.disposition === "closed" ? "closed" : "active",
      hasCredential: input.disposition !== "closed",
      updatedAt: new Date().toISOString(),
    };
    await route.fulfill({ json: account });
  });
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  const panel = page.getByRole("region", { name: "Employer accounts" });
  const row = panel.locator(".account-list li").filter({ hasText: origin });
  await row.getByRole("button", { name: "Review recovery" }).click();
  const form = panel.getByRole("group", { name: "Recovery review" });
  await form.getByLabel("Verified identity email").fill("candidate@example.test");
  await form.getByLabel("Verified replacement password").fill("synthetic-replacement-password");
  await form.getByLabel("Review evidence SHA-256").fill("b".repeat(64));
  await expect(form.getByRole("button", { name: "Record review" })).toBeDisabled();
  await form.getByLabel("Existing account and replacement credential verified").check();
  await form.screenshot({ path: `test-results/P15-account-recovery-${info.project.name}.png` });
  await form.getByRole("button", { name: "Record review" }).click();
  await expect(row).toHaveAttribute("data-account-state", "active");
  await expect(form).toHaveCount(0);
  expect(reviews[0]).toMatchObject({
    disposition: "verified_existing",
    employerOrigin: origin,
    adapterId: "synthetic-signup",
    existingAccountAndReplacementCredentialVerified: true,
  });
  expect(await page.locator("body").innerText()).not.toContain("synthetic-replacement-password");
  account = { ...account, state: "locked", updatedAt: new Date().toISOString() };
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await row.getByRole("button", { name: "Review recovery" }).click();
  await form.getByLabel("Disposition").selectOption("closed");
  await expect(form.getByLabel("Verified replacement password")).toHaveCount(0);
  await form.getByLabel("Review evidence SHA-256").fill("c".repeat(64));
  await form.getByLabel("Permanently disable this local account").check();
  await form.getByRole("button", { name: "Record review" }).click();
  await expect(row).toHaveAttribute("data-account-state", "closed");
  expect(reviews[1]).toMatchObject({ disposition: "closed", closePermanently: true });
  expect(reviews[1]).not.toHaveProperty("replacementPassword");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

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
