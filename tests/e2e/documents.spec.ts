import { expect, test } from "@playwright/test";

test("immutable document packet review and downloads remain inspectable", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  const result = await page.evaluate(async (projectName) => {
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
      const value = await response.json();
      if (!response.ok) throw new Error(`${path} returned ${response.status}: ${value.message}`);
      return value;
    };
    let candidate = await json("/v1/candidate");
    if (
      !candidate.facts.some((fact: { value: { kind: string } }) => fact.value.kind === "identity")
    )
      await json("/v1/candidate/facts", {
        expectedRevision: 0,
        key: `identity.documents.${projectName}`,
        value: {
          kind: "identity",
          fullName: "Alex Example",
          email: "alex@synthetic.example",
          phone: "+31 20 000 0000",
          links: ["https://portfolio.synthetic.example/alex"],
        },
        provenance: { kind: "owner", statement: "Synthetic browser packet identity." },
        expiresOn: null,
      });
    await json("/v1/candidate/facts", {
      expectedRevision: 0,
      key: `employment.documents.${projectName}`,
      value: {
        kind: "employment",
        employer: "Synthetic Browser Systems B.V.",
        title: "Software Engineer",
        start: "2022-01",
        end: "2025-12",
        workload: "full_time",
        description: "Built and maintained Python services with controlled releases.",
      },
      provenance: { kind: "owner", statement: "Synthetic browser packet employment." },
      expiresOn: null,
    });
    await json("/v1/candidate/facts", {
      expectedRevision: 0,
      key: `work.documents.${projectName}`,
      value: {
        kind: "work_authorization",
        country: "NL",
        currentlyAuthorized: "yes",
        permitExpiresOn: "2028-01-01",
        futureSponsorship: "no",
        approvedWording: "Authorized to work in the Netherlands without sponsorship.",
      },
      provenance: { kind: "owner", statement: "Synthetic browser packet authorization." },
      expiresOn: "2028-01-01",
    });
    candidate = await json("/v1/candidate");
    const profile = await json("/v1/candidate/profile", { expectedRevision: candidate.revision });
    const current = candidate.authorization;
    const authorization = await json("/v1/candidate/authorization", {
      expectedRevision: current?.revision ?? 0,
      mode: "auto_submit",
      profileVersionId: profile.id,
      roleTerms: ["Engineer"],
      countries: ["NL"],
      blockedEmployerIds: [],
      dailyLimit: 5,
      allowAccountCreation: false,
      allowOptionalDisclosures: false,
      sponsorshipWording: null,
      salary: null,
      salaryNegotiable: null,
      effectiveAt: "2026-09-16T00:00:00.000Z",
      expiresAt: "2026-10-16T00:00:00.000Z",
      autoSubmitAcknowledged: true,
    });
    const discovery = await json("/v1/discovery");
    const listing = discovery.listings.find((item: { job: { title: string } }) =>
      item.job.title.includes("Engineer"),
    );
    if (!listing) throw new Error("Expected a synthetic engineering vacancy.");
    const assessment = await json(`/v1/matching/jobs/${listing.jobId}/assess`, {});
    if (!assessment.applicationId) throw new Error("Expected an eligible application.");
    const packet = await json("/v1/documents/generate", {
      applicationId: assessment.applicationId,
      assessmentId: assessment.id,
      requestedAnswers: [],
      asOf: "2026-09-17",
    });
    return {
      id: packet.manifest.id as string,
      title: listing.job.title as string,
      authorization: authorization.id as string,
    };
  }, info.project.name);
  expect(result.authorization).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  const row = page.locator(`.packet-row[data-packet-id="${result.id}"]`);
  await expect(row).toBeVisible({ timeout: 25000 });
  await row.click();
  await expect(page.getByText("current", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("CV summary", { exact: true })).toBeVisible();
  await expect(page.getByText("claims checked", { exact: false })).toBeVisible();
  await expect(page.locator(".artifact-strip a")).toHaveCount(5);
  const download = page.waitForEvent("download");
  await page.locator(".artifact-strip a").filter({ hasText: "cv pdf" }).click();
  expect((await download).suggestedFilename()).toMatch(/-cv\.pdf$/);
  await page.getByText("Preview CV PDF", { exact: true }).click();
  const preview = page.getByLabel("Rendered first page of the tailored CV PDF");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-rendered", "true");
  const pixels = await preview.screenshot({
    path: `test-results/P06-cv-preview-${info.project.name}.png`,
  });
  expect(pixels.length).toBeGreaterThan(10000);
  await page.screenshot({
    path: `test-results/documents-${info.project.name}.png`,
    fullPage: true,
  });
  const dryRun = page.getByRole("region", { name: "Mock ATS dry run" });
  await dryRun.getByLabel("Phone", { exact: true }).fill("+31 20 000 0000");
  await dryRun
    .getByLabel("Portfolio", { exact: true })
    .fill("https://portfolio.synthetic.example/a-very-long-but-valid-profile-path");
  await dryRun.getByRole("combobox", { name: "Country" }).selectOption("NL");
  await dryRun.getByRole("combobox", { name: "Future sponsorship" }).selectOption("no");
  await dryRun.getByLabel("Available from", { exact: true }).fill("2026-11-01");
  await dryRun.getByRole("combobox", { name: "Remote preference" }).selectOption("yes");
  await dryRun.getByLabel("I confirm these details are accurate").check();
  await dryRun.getByRole("button", { name: "Run dry run" }).click();
  await expect(dryRun.locator(".browser-result .packet-state")).toHaveText("ready", {
    timeout: 30000,
  });
  await expect(dryRun.getByText("0 submissions")).toBeVisible();
  await page.screenshot({
    path: `test-results/P07-browser-ready-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
