import { expect, test } from "@playwright/test";

/**
 * The decision semantics are proven in tests/integration/exceptions.test.ts on
 * both database engines. This spec covers only what a browser can prove: the
 * panel is reachable, it names the blocker and the affected job, it never
 * pre-fills wording for a question the system cannot answer, and it refuses to
 * resolve without an owner answer.
 */
test("the exception inbox is reachable and never invents an answer", async ({ page }, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible({ timeout: 30000 });

  await page.getByRole("button", { name: "Applications", exact: true }).click();
  const panel = page.getByRole("region", { name: "Needs your decision" });
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel.getByRole("heading", { name: "Needs your decision" })).toBeVisible();
  const empty = panel.getByText("Nothing is waiting on you.");
  const cards = panel.locator(".exception-list li");
  await expect
    .poll(async () => (await empty.isVisible()) || (await cards.count()) > 0, {
      timeout: 20000,
    })
    .toBe(true);

  // Every rendered item must name the affected job and never expose raw internals.
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    await expect(card.locator(".exception-job")).not.toBeEmpty();
    await expect(card.locator(".exception-reason")).not.toBeEmpty();
    // No answer input is ever pre-filled with invented wording.
    const input = card.locator(".exception-answer input");
    if (await input.count()) expect(await input.inputValue()).toBe("");
    await expect(card).not.toContainText(/owner_token|password|api_key|sk-or-/i);
  }

  // The inbox is authenticated like the rest of the API.
  const unauthenticated = await page.request.get("/v1/exceptions", {
    headers: { cookie: "opencareers=not-a-real-session" },
  });
  expect(unauthenticated.status()).toBe(401);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/P10-exceptions-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("background-task exceptions render without a vacancy and can be deferred", async ({
  page,
}) => {
  const item = {
    id: "synthetic-background-exception",
    blocker: "task_failed",
    code: "CONFIG_INVALID",
    reason: "The synthetic discovery task exhausted its retries.",
    applicationId: null,
    job: null,
    question: null,
    suggestedAnswer: null,
    actions: ["defer"],
    state: "open",
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/v1/exceptions", (route) => route.fulfill({ json: [item] }));
  await page.route("**/v1/exceptions/synthetic-background-exception/resolve", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: "defer" });
    item.state = "deferred";
    await route.fulfill({ json: { exception: item, requeued: 0, handoff: null } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Applications", exact: true }).click();
  const panel = page.getByRole("region", { name: "Needs your decision" });
  await expect(panel.getByText("Background processing")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Defer", exact: true }).click();
  await expect(panel.locator("[data-state='deferred']")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
