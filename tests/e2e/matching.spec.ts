import { expect, test } from "@playwright/test";
import { allocationLimits } from "../../packages/contracts/src/agents.js";
import { ensureCandidate, ensureListing } from "../helpers/browser-setup.js";

test("free-only matching health, scores and evidence remain inspectable", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  await ensureCandidate(page, `matching-${info.project.name}`);
  await ensureListing(page);
  const assessmentOutcome = await page.evaluate(
    async ({ projectName, triageLimit }) => {
      const json = async (path: string, body?: unknown) => {
        const response = await fetch(path, {
          ...(body
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        });
        if (!response.ok) throw new Error(`${path} returned ${response.status}`);
        return response.json();
      };
      let candidate = await json("/v1/candidate");
      const authorization = candidate.authorization;
      if (!authorization) throw new Error("Expected synthetic authorization.");
      await json("/v1/candidate/facts", {
        expectedRevision: 0,
        key: `work.matching.${projectName}`,
        value: {
          kind: "work_authorization",
          country: "NL",
          currentlyAuthorized: "yes",
          permitExpiresOn: "2027-09-16",
          futureSponsorship: "no",
          approvedWording: "Synthetic authorization for browser verification.",
        },
        provenance: {
          kind: "owner",
          statement: "Synthetic browser-test authorization evidence.",
        },
        expiresOn: "2027-09-16",
      });
      candidate = await json("/v1/candidate");
      const profile = await json("/v1/candidate/profile", {
        expectedRevision: candidate.revision,
      });
      await json("/v1/candidate/authorization", {
        expectedRevision: authorization.revision,
        mode: authorization.mode,
        profileVersionId: profile.id,
        roleTerms: authorization.roleTerms,
        countries: authorization.countries,
        blockedEmployerIds: authorization.blockedEmployerIds,
        dailyLimit: authorization.dailyLimit,
        allowAccountCreation: authorization.allowAccountCreation,
        allowOptionalDisclosures: authorization.allowOptionalDisclosures,
        sponsorshipWording: authorization.sponsorshipWording,
        salary: authorization.salary,
        salaryNegotiable: authorization.salaryNegotiable,
        effectiveAt: authorization.effectiveAt,
        expiresAt: authorization.expiresAt,
        autoSubmitAcknowledged: authorization.autoSubmitAcknowledged,
      });
      const discovery = await json("/v1/discovery");
      const operations = await json("/v1/operations/summary");
      const unavailable = new Set(
        operations.applications
          .filter((application: { state: string }) =>
            ["CONFIRMED", "HISTORICAL_SUBMITTED", "IN_FLIGHT", "UNKNOWN"].includes(
              application.state,
            ),
          )
          .map((application: { jobId: string }) => application.jobId),
      );
      const eligible = discovery.listings.find(
        (item: { jobId: string }) => !unavailable.has(item.jobId),
      );
      const jobId = eligible?.jobId ?? discovery.listings[0]?.jobId;
      if (!jobId) throw new Error("Expected a discovered synthetic vacancy.");
      const assessment = await json(`/v1/matching/jobs/${jobId}/assess`, {});
      const matching = await json("/v1/matching");
      const quotaDeferred =
        eligible &&
        assessment.explanation === "Inference task-class allocation is exhausted." &&
        matching.route.status === "fixture" &&
        matching.budget.used >= triageLimit;
      const listing = discovery.listings.find((item: { jobId: string }) => item.jobId === jobId);
      if (!listing) throw new Error("Expected assessed listing evidence.");
      return {
        outcome: assessment.outcome as string,
        expectedOutcome: eligible
          ? quotaDeferred
            ? "inference_paused"
            : "auto_eligible"
          : "ineligible",
        title: listing.job.title as string,
      };
    },
    { projectName: info.project.name, triageLimit: allocationLimits.semantic_triage },
  );
  expect(assessmentOutcome.outcome).toBe(assessmentOutcome.expectedOutcome);
  await page.reload();
  await page.getByRole("button", { name: "Matching", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Matching", exact: true })).toBeVisible();
  await expect(page.getByText("synthetic fixture inference only", { exact: false })).toBeVisible({
    timeout: 25000,
  });
  await expect(page.getByText("Synthetic fixture inference only.", { exact: true })).toBeVisible();
  const assessment = page
    .locator(".matching-table tbody tr")
    .filter({ hasText: assessmentOutcome.title })
    .filter({ hasText: assessmentOutcome.expectedOutcome.replaceAll("_", " ") })
    .first();
  await expect(assessment).toBeVisible({ timeout: 25000 });
  await assessment.getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Policy gates", exact: true })).toBeVisible();
  await expect(page.getByText("Scores are deterministic, not hiring probabilities")).toBeVisible();
  await expect(page.locator(".assessment-panel")).toContainText(
    assessmentOutcome.expectedOutcome === "auto_eligible"
      ? "Python"
      : assessmentOutcome.expectedOutcome === "inference_paused"
        ? "Inference task-class allocation is exhausted."
        : "An existing application or history record matches.",
  );
  await page.screenshot({
    path: `test-results/matching-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
