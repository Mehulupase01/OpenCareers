import { expect, test } from "@playwright/test";
import { syntheticDocx } from "../helpers/document-fixtures.js";

test("candidate evidence, reviewed profile and revocable standing authorization", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  await page.getByRole("button", { name: "Candidate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Candidate facts" })).toBeVisible();
  const existing = page.getByRole("button", { name: "Edit identity.e2e", exact: true });
  if (await existing.count()) await existing.click();
  else await page.getByRole("button", { name: "Add fact", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("combobox", { name: "Category", exact: true }).selectOption("identity");
  await editor.getByLabel("Fact key", { exact: true }).fill("identity.e2e");
  await editor.getByLabel("Full name", { exact: true }).fill("Alex Example");
  await editor.getByLabel("Email", { exact: true }).fill("alex@synthetic.example");
  await editor
    .getByRole("textbox", { name: "Owner assertion", exact: true })
    .fill("Synthetic test candidate identity, explicitly asserted by the fixture owner.");
  await editor.getByRole("button", { name: "Save fact", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByLabel("Import document", { exact: true }).setInputFiles({
    name: "synthetic-e2e.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await syntheticDocx(),
  });
  await expect(page.getByRole("heading", { name: "synthetic-e2e.docx", exact: true })).toBeVisible({
    timeout: 25000,
  });
  await expect(page.getByText("Python", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Profile", exact: true }).click();
  const existingSkill = page.getByRole("button", { name: "Edit skill.e2e", exact: true });
  if (await existingSkill.count()) await existingSkill.click();
  else await page.getByRole("button", { name: "Add fact", exact: true }).click();
  await editor.getByRole("combobox", { name: "Category", exact: true }).selectOption("skill");
  await editor.getByLabel("Fact key", { exact: true }).fill("skill.e2e");
  await editor.getByLabel("Skill", { exact: true }).fill("Python");
  await editor.getByRole("combobox", { name: "Evidence", exact: true }).selectOption("source");
  await editor
    .getByRole("combobox", { name: "Document", exact: true })
    .selectOption({ label: "synthetic-e2e.docx" });
  const passage = editor.getByRole("combobox", { name: "Source locator", exact: true });
  await expect(passage.locator("option").filter({ hasText: "Python" })).toHaveCount(1);
  const value = await passage.locator("option").filter({ hasText: "Python" }).getAttribute("value");
  await passage.selectOption(value ?? "");
  await editor.getByRole("button", { name: "Save fact", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "Verify skill.e2e", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verify skill.e2e", exact: true })).toHaveCount(0);
  const published = page.waitForResponse(
    (r) => r.url().endsWith("/v1/candidate/profile") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish profile", exact: true }).click();
  expect((await published).status()).toBe(200);
  await expect(page.getByText(/Published revision/)).toBeVisible();
  await expect(page.getByText("Unpublished profile changes", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: `test-results/candidate-profile-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Authorization", exact: true }).click();
  await page.getByRole("radio", { name: "auto submit", exact: true }).check();
  await page.getByRole("textbox", { name: "Role terms", exact: true }).fill("Engineer");
  await page
    .getByLabel(
      "I authorize final submissions within this policy without per-application confirmation.",
      { exact: true },
    )
    .check();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/v1/candidate/authorization") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save authorization", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("link", { name: "Export authorization" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export authorization" }).click();
  expect((await download).suggestedFilename()).toBe("opencareers-authorization.txt");
  await page.screenshot({
    path: `test-results/candidate-policy-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Revoke authorization", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Revoke authorization", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Answers", exact: true }).click();
  await page.getByLabel("Semantic key", { exact: true }).fill("identity.name.e2e");
  await page.getByLabel("Exact question meaning", { exact: true }).fill("Full legal name");
  await page.getByLabel("Approved answer", { exact: true }).fill("Alex Example");
  await page
    .getByRole("checkbox", { name: "Alex Example | alex@synthetic.example", exact: true })
    .check();
  const answer = page.waitForResponse(
    (r) => r.url().endsWith("/v1/candidate/answers") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Approve answer", exact: true }).click();
  expect((await answer).status()).toBe(200);
  await expect(page.locator(".answer-list article").last()).toContainText("Alex Example");
  expect(errors).toEqual([]);
});
