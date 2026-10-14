import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { FixedCohort } from "../../packages/contracts/src/cohort.js";
import { DomainError } from "../../packages/contracts/src/index.js";
import {
  compareFixedCohorts,
  fixedCohortReport,
} from "../../packages/matching/src/cohort-report.js";

test("frozen vacancy signals distinguish unknown from legacy and refuse mixed comparisons", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const snapshot: FixedCohort = {
    id: randomUUID(),
    methodology: "fixed_current_outcome_at_observation_horizon_v1",
    window: {
      from: "2026-08-01T00:00:00.000Z",
      through: "2026-08-31T23:59:59.999Z",
      asOf: "2026-10-01T00:00:00.000Z",
      observationDays: 30,
      minimumSample: 20,
    },
    recordedAt: "2026-10-01T00:00:00.000Z",
    exclusions: { synthetic: 3, stillObserving: 2 },
    members: Array.from({ length: 40 }, (_, index) => ({
      applicationId: randomUUID(),
      jobId: randomUUID(),
      receiptId: randomUUID(),
      receiptSha256: "a".repeat(64),
      receivedAt: "2026-08-01T00:00:00.000Z",
      horizon: "2026-08-31T00:00:00.000Z",
      outcome: index < 20 ? "INTERVIEW" : "UNKNOWN",
      outcomeEventId: null,
      outcomeEvidenceSha256: null,
      metadataSha256: "b".repeat(64),
      metadataOrigin: "submission_intent",
      vacancySignalsMethod: "explicit_vacancy_signals_v1",
      groups: {
        source: "synthetic-source",
        roleFamily: "engineering",
        seniority: index < 20 ? "senior" : "junior",
        sponsorship: index < 20 ? "explicitly_available" : "explicitly_unavailable",
        documentTemplate: "unknown",
      },
    })),
  };
  const mixed: FixedCohort = {
    ...snapshot,
    id: randomUUID(),
    members: snapshot.members.map((member, index) =>
      index < 20
        ? member
        : {
            ...member,
            vacancySignalsMethod: undefined,
            groups: { ...member.groups, seniority: "unknown", sponsorship: "unknown" },
          },
    ),
  };
  const unknown: FixedCohort = {
    ...mixed,
    id: randomUUID(),
    members: mixed.members.map((member) => ({
      ...member,
      vacancySignalsMethod: "explicit_vacancy_signals_v1",
    })),
  };
  const snapshots = [snapshot, mixed, unknown];
  await page.route("**/v1/outcomes/cohorts**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/compare")) {
      const input = route.request().postDataJSON();
      const selected = snapshots.find((item) => item.id === input.leftSnapshotId);
      if (!selected) throw new Error("Unknown synthetic snapshot");
      try {
        await route.fulfill({
          json: compareFixedCohorts(
            selected,
            selected,
            input.dimension,
            input.leftValue,
            input.rightValue,
          ),
        });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        await route.fulfill({ status: 409, json: { code: error.code, message: error.message } });
      }
    } else if (path.endsWith("/cohorts")) {
      await route.fulfill({
        json: snapshots.map((item) => ({
          id: item.id,
          window: item.window,
          denominator: 40,
          status: "measured",
        })),
      });
    } else {
      const selected = snapshots.find((item) => path.endsWith(item.id));
      if (!selected) throw new Error("Unknown synthetic snapshot");
      await route.fulfill({ json: fixedCohortReport(selected) });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Outcomes", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Fixed outcome cohorts" });
  const open = async (id: string) => {
    await workspace.getByLabel("Saved cohort", { exact: true }).selectOption(id);
    await workspace.getByRole("button", { name: "Open fixed cohort" }).click();
  };
  const compare = async (left: string, right: string) => {
    await workspace.getByLabel("Left cohort group", { exact: true }).selectOption(left);
    await workspace.getByLabel("Right cohort group", { exact: true }).selectOption(right);
    await workspace.getByRole("button", { name: "Compare fixed groups" }).click();
  };
  await open(snapshot.id);
  await expect(workspace).toContainText("40 classified / 0 legacy unavailable");
  await workspace.getByLabel("Group dimension", { exact: true }).selectOption("seniority");
  await expect(
    workspace
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "senior", exact: true }) }),
  ).toContainText("20 classified / 0 unavailable");
  await compare("senior", "junior");
  await expect(
    workspace.getByRole("heading", { name: "Descriptive group comparison" }),
  ).toBeVisible();
  await workspace.getByLabel("Group dimension", { exact: true }).selectOption("sponsorship");
  await expect(
    workspace.getByRole("cell", { name: "Explicitly unavailable", exact: true }),
  ).toBeVisible();
  await compare("explicitly_available", "explicitly_unavailable");
  await expect(
    workspace.getByRole("heading", { name: "Descriptive group comparison" }),
  ).toBeVisible();
  await workspace.screenshot({ path: `test-results/P16-vacancy-signals-${info.project.name}.png` });
  await open(mixed.id);
  await expect(workspace).toContainText("20 classified / 20 legacy unavailable");
  await compare("explicitly_available", "unknown");
  await expect(workspace.getByRole("alert")).toContainText(
    "consistent intent-time classification provenance",
  );
  await open(unknown.id);
  await expect(workspace).toContainText("40 classified / 0 legacy unavailable");
  await compare("explicitly_available", "unknown");
  await expect(
    workspace.getByRole("heading", { name: "Descriptive group comparison" }),
  ).toBeVisible();
  await expect(workspace).toContainText("40 eligible applications");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
