import { expect, test } from "@playwright/test";

test("free-only matching health, scores and evidence remain inspectable", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  const assessmentOutcome = await page.evaluate(async (projectName) => {
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
    const jobId = discovery.listings[0]?.jobId;
    if (!jobId) throw new Error("Expected a discovered synthetic vacancy.");
    return (await json(`/v1/matching/jobs/${jobId}/assess`, {})).outcome as string;
  }, info.project.name);
  expect(assessmentOutcome).toBe("auto_eligible");
  await page.reload();
  await page.getByRole("button", { name: "Matching", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Matching", exact: true })).toBeVisible();
  await expect(page.getByText("synthetic fixture inference only", { exact: false })).toBeVisible({
    timeout: 25000,
  });
  await expect(page.getByText("Synthetic fixture inference only.", { exact: true })).toBeVisible();
  const assessment = page.locator(".matching-table tbody tr").first();
  await expect(assessment).toBeVisible({ timeout: 25000 });
  await assessment.getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Policy gates", exact: true })).toBeVisible();
  await expect(page.getByText("Scores are deterministic, not hiring probabilities")).toBeVisible();
  await expect(page.locator(".assessment-panel")).toContainText("Python");
  await page.screenshot({
    path: `test-results/matching-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
