import { expect, test } from "@playwright/test";

for (const legacy of [true, false]) {
  test(`${legacy ? "legacy" : "archive"} recovery preserves review gates and handles refused receipt evidence`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const id = "2d159734-297f-44ad-9552-0d05fac5bbe4";
    const applicationId = "8c353431-f3a0-42d0-aceb-1f31581d064c";
    const captured = "2026-01-01T00:00:00.000Z";
    let run = {
      id,
      state: "open",
      snapshot_sha256: "a".repeat(64),
      snapshot_created_at: legacy ? null : captured,
      started_at: "2026-02-01T00:00:00.000Z",
    };
    let review = {
      run_id: id,
      application_id: applicationId,
      disposition: "pending",
      receipt_id: null,
    };
    const posts: { path: string; input: Record<string, unknown> }[] = [];
    await page.route("**/v1/restores", (route) =>
      route.fulfill({
        json: {
          control: {
            restoreBlocked: run.state === "open",
            submissionsPaused: true,
            discoveryPaused: true,
            preparationPaused: true,
            stopped: true,
          },
          runs: [run],
          reviews: [review],
        },
      }),
    );
    await page.route(`**/v1/restores/${id}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const input = route.request().postDataJSON();
      posts.push({ path, input });
      if (path.endsWith("/backup-boundary"))
        run = { ...run, snapshot_created_at: String(input.capturedAtOrAfter) };
      if (path.endsWith("/review")) {
        if (input.disposition === "receipt") {
          await route.fulfill({
            status: 409,
            json: { message: "A correlated confirmed receipt is required." },
          });
          return;
        }
        review = { ...review, disposition: "quarantined" };
      }
      if (path.endsWith("/release")) run = { ...run, state: "completed" };
      await route.fulfill({ json: { status: "reviewed" } });
    });
    await page.goto("/");
    await expect(page.getByText("No real applications submitted")).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Controls", exact: true }).click();
    const panel = page.getByRole("region", { name: "Backup recovery" });
    await expect(panel).toBeVisible();
    const history = panel.getByRole("group", { name: "External-history review" });
    const complete = history.getByRole("button", { name: "Complete restore review" });
    await expect(complete).toBeDisabled();
    if (legacy) {
      const boundary = panel.getByRole("group", { name: "Legacy backup boundary" });
      await boundary.getByLabel("Verified capture lower bound (UTC)").fill(captured);
      await boundary.getByLabel("Boundary evidence SHA-256").fill("b".repeat(64));
      await boundary.getByRole("button", { name: "Record backup boundary" }).click();
      expect(posts).toHaveLength(0);
      await boundary
        .getByLabel("I verified this backup was captured at or after this boundary")
        .check();
      await boundary.getByRole("button", { name: "Record backup boundary" }).click();
      await expect(boundary).toHaveCount(0);
      expect(posts[0]?.input).toEqual({
        snapshotSha256: run.snapshot_sha256,
        capturedAtOrAfter: captured,
        evidenceSha256: "b".repeat(64),
        backupBoundaryVerified: true,
      });
    } else {
      await expect(panel.getByRole("group", { name: "Legacy backup boundary" })).toHaveCount(0);
    }
    await expect(complete).toBeDisabled();
    const application = panel.getByRole("group", { name: "Application disposition" });
    await application
      .getByRole("combobox", { name: "Disposition", exact: true })
      .selectOption("receipt");
    await application
      .getByLabel("Confirmed receipt ID")
      .fill("e1e14817-d210-4070-bad7-6c98b0122e18");
    await application.getByLabel("Review note").fill("Synthetic review evidence");
    await application.getByRole("button", { name: "Record application review" }).click();
    await expect(panel.getByRole("alert")).toContainText("correlated confirmed receipt");
    await expect(complete).toBeDisabled();
    await application
      .getByRole("combobox", { name: "Disposition", exact: true })
      .selectOption("quarantined");
    await expect(application.getByLabel("Confirmed receipt ID")).toHaveCount(0);
    await application.getByRole("button", { name: "Record application review" }).click();
    await expect(complete).toBeEnabled();
    expect(posts.find((post) => post.input.disposition === "quarantined")?.input).toEqual({
      disposition: "quarantined",
      note: "Synthetic review evidence",
    });
    await expect(history.getByLabel("History reviewed from (UTC)")).toHaveValue(captured);
    await history.getByLabel("History reviewed through (UTC)").fill("2026-02-01T00:00:00.000Z");
    await history.getByLabel("History evidence SHA-256").fill("c".repeat(64));
    await history
      .getByLabel("I reviewed external history and imported missing post-backup applications")
      .check();
    await panel.screenshot({
      path: `test-results/P15-restore-${legacy ? "legacy" : "archive"}-${info.project.name}.png`,
    });
    await complete.click();
    await expect(panel.getByText("Review completed", { exact: true })).toBeVisible();
    expect(posts.at(-1)?.input).toEqual({
      externalHistoryReviewedAndImported: true,
      evidenceSha256: "c".repeat(64),
      from: captured,
      through: "2026-02-01T00:00:00.000Z",
    });
    await expect(complete).toHaveCount(0);
    await expect(panel.getByRole("status")).toContainText("Submissions remain paused");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
