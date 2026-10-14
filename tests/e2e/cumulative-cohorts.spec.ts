import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { FixedCohort } from "../../packages/contracts/src/cohort.js";
import {
  compareFixedCohorts,
  fixedCohortReport,
} from "../../packages/matching/src/cohort-report.js";

test("cumulative observations remain distinct from current status, legacy gaps and undersized groups", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const snapshot: FixedCohort = {
    id: randomUUID(),
    methodology: "fixed_current_outcome_at_observation_horizon_v1",
    cumulativeMethodology: "corrected_observed_milestones_v1",
    window: {
      from: "2026-08-01T00:00:00.000Z",
      through: "2026-08-31T23:59:59.999Z",
      asOf: "2026-10-01T00:00:00.000Z",
      observationDays: 30,
      minimumSample: 20,
    },
    recordedAt: "2026-10-01T00:00:00.000Z",
    exclusions: { synthetic: 4, stillObserving: 2 },
    members: Array.from({ length: 40 }, (_, index) => ({
      applicationId: randomUUID(),
      jobId: randomUUID(),
      receiptId: randomUUID(),
      receiptSha256: "a".repeat(64),
      receivedAt: "2026-08-01T00:00:00.000Z",
      horizon: "2026-08-31T00:00:00.000Z",
      outcome: index < 20 ? "REJECTION" : "OFFER",
      outcomeEventId: randomUUID(),
      outcomeEvidenceSha256: "b".repeat(64),
      metadataSha256: "c".repeat(64),
      cumulativeEvidence: {
        historySha256: "d".repeat(64),
        milestones: [
          {
            kind: index < 20 ? "INTERVIEW" : "OFFER",
            eventId: randomUUID(),
            revision: 1,
            evidenceSha256: "e".repeat(64),
            occurredAt: "2026-08-10T00:00:00.000Z",
          },
        ],
      },
      groups: {
        source: index < 20 ? "source-a" : "source-b",
        roleFamily: "engineering",
        seniority: "unknown",
        sponsorship: "unknown",
        documentTemplate: "unknown",
      },
    })),
  };
  const legacy: FixedCohort = {
    ...snapshot,
    id: randomUUID(),
    cumulativeMethodology: undefined,
    members: snapshot.members.map(({ cumulativeEvidence: _evidence, ...member }) => member),
  };
  const small: FixedCohort = {
    ...snapshot,
    id: randomUUID(),
    members: snapshot.members.slice(0, 39),
  };
  const snapshots = [snapshot, legacy, small];
  await page.route("**/v1/outcomes/cohorts**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/compare")) {
      const input = route.request().postDataJSON();
      const selected = snapshots.find((item) => item.id === input.leftSnapshotId);
      if (!selected) throw new Error("Unknown synthetic snapshot");
      await route.fulfill({
        json: compareFixedCohorts(
          selected,
          selected,
          input.dimension,
          input.leftValue,
          input.rightValue,
        ),
      });
    } else if (url.pathname.endsWith("/cohorts")) {
      await route.fulfill({
        json: snapshots.map((item) => ({
          id: item.id,
          window: item.window,
          denominator: item.members.length,
          status: "measured",
        })),
      });
    } else {
      const selected = snapshots.find((item) => url.pathname.endsWith(item.id));
      if (!selected) throw new Error("Unknown synthetic snapshot");
      await route.fulfill({ json: fixedCohortReport(selected) });
    }
  });
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Outcomes", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Fixed outcome cohorts" });
  const open = async (id: string) => {
    await workspace.getByRole("combobox", { name: "Saved cohort" }).selectOption(id);
    await workspace.getByRole("button", { name: "Open fixed cohort" }).click();
  };
  await open(snapshot.id);
  const cumulative = workspace.getByRole("region", { name: "Cumulative observed outcomes" });
  const table = cumulative.getByRole("table", { name: "Cumulative cohort counts" });
  const total = table.getByRole("row").filter({ hasText: "All eligible applications" });
  await expect(total).toContainText("20/40 (0.500)");
  const sourceA = table.getByRole("row").filter({ hasText: "source-a" });
  await expect(sourceA).toContainText("20/20 (1.000)");
  await expect(sourceA).toContainText("0/20 (0.000)");
  const compare = async () => {
    await workspace.getByRole("combobox", { name: "Left cohort group" }).selectOption("source-a");
    await workspace.getByRole("combobox", { name: "Right cohort group" }).selectOption("source-b");
    await workspace.getByRole("button", { name: "Compare fixed groups" }).click();
  };
  await compare();
  const comparisons = workspace.getByRole("region", { name: "Cumulative group comparison" });
  await expect(comparisons.getByRole("row").filter({ hasText: "Interview" })).toContainText(
    "1.000",
  );
  await cumulative.screenshot({ path: `test-results/P16-cumulative-${info.project.name}.png` });
  await open(legacy.id);
  await expect(cumulative).toContainText("Unavailable for this legacy snapshot.");
  await expect(table).toHaveCount(0);
  await open(small.id);
  await expect(table.getByRole("row").filter({ hasText: "source-b" })).toContainText(
    "Insufficient data",
  );
  await compare();
  await expect(comparisons).toContainText("Insufficient cumulative comparison data.");
  await expect(comparisons.getByRole("table")).toHaveCount(0);
  await expect(workspace).toContainText("synthetic");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
