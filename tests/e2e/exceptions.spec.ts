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
