import { expect, test } from "@playwright/test";
import { ensureCandidate, ensureListing } from "../helpers/browser-setup.js";

test("immutable document packet review and downloads remain inspectable", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("No real applications submitted")).toBeVisible();
  // Run outside the browser context: this uses page.request, not page.evaluate.
  await ensureCandidate(page, "documents");
  const guaranteed = await ensureListing(page);
  const result = await page.evaluate(
    async ({ projectName, guaranteed }) => {
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
      const fixturePhone = "+31 20 000 0000";
      const fixturePortfolio =
        "https://portfolio.synthetic.example/a-very-long-but-valid-profile-path";
      const identityFact = candidate.facts.find(
        (fact: { value: { kind: string } }) => fact.value.kind === "identity",
      ) as
        | {
            id: string;
            key: string;
            revision: number;
            value: { kind: string; phone: string; links: string[] };
            expiresOn: string | null;
          }
        | undefined;
      if (!identityFact)
        await json("/v1/candidate/facts", {
          expectedRevision: 0,
          key: `identity.documents.${projectName}`,
          value: {
            kind: "identity",
            fullName: "Alex Example",
            email: "alex@synthetic.example",
            phone: fixturePhone,
            links: [fixturePortfolio],
          },
          provenance: { kind: "owner", statement: "Synthetic browser packet identity." },
          expiresOn: null,
        });
      else if (!identityFact.value.phone || identityFact.value.links[0] !== fixturePortfolio)
        await json("/v1/candidate/facts", {
          id: identityFact.id,
          expectedRevision: identityFact.revision,
          key: identityFact.key,
          value: {
            ...identityFact.value,
            phone: identityFact.value.phone || fixturePhone,
            links: [fixturePortfolio],
          },
          provenance: { kind: "owner", statement: "Synthetic reviewed portfolio link." },
          expiresOn: identityFact.expiresOn,
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
      // `guaranteed` already excludes any job that is confirmed or in flight, so
      // this spec no longer has to reconstruct that filter itself.
      const listing = guaranteed;
      const assessment = await json(`/v1/matching/jobs/${listing.jobId}/assess`, {});
      if (!assessment.applicationId)
        throw new Error(
          `Expected an eligible application: ${JSON.stringify(assessment).slice(0, 500)}`,
        );
      const packet = await json("/v1/documents/generate", {
        applicationId: assessment.applicationId,
        assessmentId: assessment.id,
        requestedAnswers: [],
        asOf: "2026-09-17",
      });
      return {
        id: packet.manifest.id as string,
        applicationId: assessment.applicationId as string,
        title: listing.job.title as string,
        authorization: authorization.id as string,
        phone: packet.content.cv.identity.phone as string,
        portfolio: (packet.content.cv.identity.links[0] ?? "") as string,
      };
    },
    { projectName: info.project.name, guaranteed: guaranteed },
  );
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
  await expect(dryRun.getByLabel("Phone", { exact: true })).toHaveValue(result.phone);
  await expect(dryRun.getByLabel("Portfolio", { exact: true })).toHaveValue(result.portfolio);
  expect(result.phone).not.toBe("");
  expect(result.portfolio).toBe(
    "https://portfolio.synthetic.example/a-very-long-but-valid-profile-path",
  );
  await expect(dryRun.getByLabel("Phone", { exact: true })).toHaveAttribute("readonly");
  await expect(dryRun.getByLabel("Portfolio", { exact: true })).toHaveAttribute("readonly");
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
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/v1/operations/summary");
        const summary = await response.json();
        return summary.applications.find(
          (application: { id: string }) => application.id === result.applicationId,
        )?.state as string | undefined;
      },
      { timeout: 30000 },
    )
    .toBe("CONFIRMED");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
