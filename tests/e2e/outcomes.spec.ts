import { expect, test } from "@playwright/test";
import { makeJson } from "../helpers/browser-setup.js";

test("outcome history preserves corrections and synthetic cohorts refuse live fractions", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  const json = makeJson(page);
  const summary = await json("/v1/operations/summary");
  const application = summary.applications[0];
  expect(application).toBeDefined();
  await page.getByRole("button", { name: "Outcomes", exact: true }).click();
  await page.getByLabel("Application", { exact: true }).selectOption(application.id);
  await expect(page.getByText("No recorded outcome", { exact: true })).toBeVisible();
  for (const kind of ["UNKNOWN", "INTERVIEW"]) {
    await page.getByLabel("Outcome", { exact: true }).selectOption(kind);
    const { asOf } = await json("/v1/operations/summary");
    const local = await page.evaluate((serverTime: string) => {
      const d = new Date(serverTime);
      const p = (n: number) => String(n).padStart(2, "0");
      const input = document.createElement("input");
      input.type = "datetime-local";
      input.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
      return input.value;
    }, asOf);
    await page.getByLabel("Occurred at", { exact: true }).fill(local);
    await page
      .getByLabel("Evidence reference", { exact: true })
      .fill(`synthetic-${kind.toLowerCase()}`);
    await page.getByLabel("Evidence SHA-256", { exact: true }).fill("a".repeat(64));
    await page.getByRole("button", { name: "Record outcome", exact: true }).click();
    await expect(page.getByRole("cell", { name: kind, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Restore revision 1", exact: true }).click();
  await expect(page.getByRole("cell", { name: "reversal", exact: true })).toBeVisible();
  const history = await json(`/v1/outcomes/${application.id}`);
  expect(history.map((event: { kind: string }) => event.kind)).toEqual([
    "UNKNOWN",
    "INTERVIEW",
    "UNKNOWN",
  ]);
  const after = await json("/v1/operations/summary");
  expect(after.applications.find((a: { id: string }) => a.id === application.id).state).toBe(
    application.state,
  );
  await page.getByRole("button", { name: "Run report", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Insufficient live data", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/0 eligible applications/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Fraction", exact: true })).toHaveCount(0);
  const cohorts = page.getByRole("region", { name: "Fixed outcome cohorts" });
  await expect(cohorts.getByRole("button", { name: "Freeze cohort", exact: true })).toBeEnabled();
  await cohorts.getByRole("button", { name: "Freeze cohort", exact: true }).click();
  await expect(
    cohorts.getByRole("heading", { name: "Insufficient fixed-cohort data", exact: true }),
  ).toBeVisible();
  await expect(cohorts.getByRole("status")).toContainText("0 eligible applications");
  const selected = await cohorts.getByLabel("Saved cohort", { exact: true }).inputValue();
  expect(selected).toBeTruthy();
  await expect(cohorts.getByRole("button", { name: "Freeze cohort", exact: true })).toBeEnabled();
  await cohorts.getByRole("button", { name: "Freeze cohort", exact: true }).click();
  await expect(cohorts.getByRole("button", { name: "Freeze cohort", exact: true })).toBeEnabled();
  expect(
    (await json("/v1/outcomes/cohorts")).filter((item: { id: string }) => item.id === selected),
  ).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "Outcomes", exact: true }).click();
  await expect(cohorts.getByLabel("Saved cohort", { exact: true })).toBeEnabled();
  await cohorts.getByLabel("Saved cohort", { exact: true }).selectOption(selected);
  await cohorts.getByRole("button", { name: "Open fixed cohort", exact: true }).click();
  await expect(
    cohorts.getByRole("heading", { name: "Insufficient fixed-cohort data", exact: true }),
  ).toBeVisible();
  await expect(
    cohorts.getByRole("button", { name: "Compare fixed groups", exact: true }),
  ).toBeDisabled();
  const experiments = page.getByRole("region", { name: "Controlled experiments" });
  const experimentId = await page.evaluate(() => crypto.randomUUID());
  const definition = {
    id: experimentId,
    metric: "INTERVIEW",
    observationDays: 30,
    maximumAssignments: 2,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    variants: [
      { id: "baseline", kind: "wording", approvalSha256: "a".repeat(64) },
      { id: "concise", kind: "wording", approvalSha256: "b".repeat(64) },
    ],
  };
  await experiments.getByLabel("Experiment definition", { exact: true }).setInputFiles({
    name: "synthetic-experiment.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(definition)),
  });
  await expect(
    experiments.getByRole("button", { name: "Record experiment", exact: true }),
  ).toBeDisabled();
  await experiments
    .getByLabel("Owner-approved variants and stop conditions", { exact: true })
    .check();
  await experiments.getByRole("button", { name: "Record experiment", exact: true }).click();
  await expect(experiments.getByLabel("Saved experiment", { exact: true })).toHaveValue(
    experimentId,
  );
  await expect(
    experiments.getByRole("button", { name: "Stop experiment", exact: true }),
  ).toBeEnabled();
  await experiments.getByRole("button", { name: "Open assignments", exact: true }).click();
  await expect(
    experiments.getByRole("columnheader", { name: "Variant", exact: true }),
  ).toBeVisible();
  await experiments.getByRole("button", { name: "Stop experiment", exact: true }).click();
  await expect(experiments.getByText("stopped / revision 2", { exact: true })).toBeVisible();
  await expect(
    experiments.getByRole("button", { name: "Assign reviewed packet", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Outcomes", exact: true }).click();
  await experiments.getByLabel("Saved experiment", { exact: true }).selectOption(experimentId);
  await expect(experiments.getByText("stopped / revision 2", { exact: true })).toBeVisible();
  await expect(
    experiments.getByRole("button", { name: "Stop experiment", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `test-results/outcomes-${info.project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});
