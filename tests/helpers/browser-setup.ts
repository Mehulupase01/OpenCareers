import type { Page } from "@playwright/test";
import { testOrigin } from "./browser-endpoints.js";

export type Json = (path: string, body?: unknown) => Promise<any>;

export const makeJson =
  (page: Page): Json =>
  async (path, body) => {
    const response = await page.request.fetch(path, {
      // A state-changing request through page.request does not carry the browser's
      // own cookie jar, so the trusted origin is passed explicitly. Without it the
      // API answers 403 and the spec looks broken for no real reason.
      headers: { origin: testOrigin },
      ...(body === undefined
        ? { method: "GET" }
        : { method: "POST", data: body as Record<string, unknown> }),
    });
    const value = await response.json();
    if (!response.ok())
      throw new Error(`${path} returned ${response.status()}: ${String(value?.message ?? "")}`);
    return value;
  };

interface Listing {
  jobId: string;
  job: { id: string; title: string; company: string; employerId: string };
}

export async function ensureListing(page: Page): Promise<Listing> {
  const json = makeJson(page);
  const company = "Synthetic Browser Employer";

  /** A job that is already confirmed or in flight cannot be assessed again. */
  const usable = async () => {
    const [discovery, operations] = [
      (await json("/v1/discovery")) as { listings: Listing[] },
      (await json("/v1/operations/summary")) as {
        applications: { jobId: string; state: string }[];
      },
    ];
    const taken = new Set(
      operations.applications
        .filter((application) =>
          ["CONFIRMED", "HISTORICAL_SUBMITTED", "IN_FLIGHT", "UNKNOWN", "RECONCILING"].includes(
            application.state,
          ),
        )
        .map((application) => application.jobId),
    );
    return discovery.listings.find(
      (item) => item.job.title.includes("Engineer") && !taken.has(item.jobId),
    );
  };

  const existing = await usable();
  if (existing) return existing;

  const snapshot = (await json("/v1/discovery")) as {
    sources: { id: string; company: string }[];
  };
  let source = snapshot.sources.find((item) => item.company === company);
  if (!source) {
    const created = (await json("/v1/discovery/sources", {
      expectedRevision: 0,
      connector: "greenhouse",
      board: "synthetic-browser",
      region: "global",
      employerId: "synthetic-browser-employer",
      company,
      intervalSeconds: 3600,
      enabled: true,
      mode: "fixture",
    })) as { source?: { id: string } } & { id: string };
    source = { id: (created.source ?? created).id, company };
  }
  await json(`/v1/discovery/sources/${source.id}/poll`, { acknowledgeQuality: true });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const listing = await usable();
    if (listing) return listing;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Expected an assessable synthetic engineering vacancy after polling.");
}

/**
 * Guarantees a published profile and an active authorization, adding the reviewed
 * facts the eligibility gates require. Existing revisions are reused so the suite
 * stays idempotent across repeated runs.
 */
export async function ensureCandidate(page: Page, suffix: string): Promise<{ profileId: string }> {
  const json = makeJson(page);
  const candidate = await json("/v1/candidate");
  const has = (kind: string) =>
    (candidate.facts as { value: { kind: string } }[]).some((fact) => fact.value.kind === kind);

  if (!has("identity"))
    await json("/v1/candidate/facts", {
      expectedRevision: 0,
      key: `identity.browser.${suffix}`,
      value: {
        kind: "identity",
        fullName: "Alex Example",
        email: "alex@synthetic.example",
        phone: "+31 20 000 0000",
        links: ["https://portfolio.synthetic.example/a-very-long-but-valid-profile-path"],
      },
      provenance: { kind: "owner", statement: "Synthetic browser-test identity." },
      expiresOn: null,
    });
  if (!has("skill"))
    for (const [index, skill] of ["Python", "TypeScript", "Machine Learning", "LLM"].entries())
      await json("/v1/candidate/facts", {
        expectedRevision: 0,
        key: `skill.browser.${suffix}.${index}`,
        value: { kind: "skill", name: skill, firstUsed: "2021-01" },
        provenance: { kind: "owner", statement: `Synthetic reviewed ${skill} evidence.` },
        expiresOn: null,
      });
  if (!has("language"))
    await json("/v1/candidate/facts", {
      expectedRevision: 0,
      key: `language.browser.${suffix}`,
      value: { kind: "language", name: "English", level: "C2" },
      provenance: { kind: "owner", statement: "Synthetic reviewed English evidence." },
      expiresOn: null,
    });
  if (!has("employment"))
    await json("/v1/candidate/facts", {
      expectedRevision: 0,
      key: `employment.browser.${suffix}`,
      value: {
        kind: "employment",
        employer: "Synthetic Browser Systems B.V.",
        title: "Software Engineer",
        start: "2022-01",
        end: "2025-12",
        workload: "full_time",
        description: "Built and maintained Python services with controlled releases.",
      },
      provenance: { kind: "owner", statement: "Synthetic browser-test employment." },
      expiresOn: null,
    });
  if (!has("work_authorization"))
    await json("/v1/candidate/facts", {
      expectedRevision: 0,
      key: `work.browser.${suffix}`,
      value: {
        kind: "work_authorization",
        country: "NL",
        currentlyAuthorized: "yes",
        permitExpiresOn: "2028-01-01",
        futureSponsorship: "no",
        approvedWording: "Authorized to work in the Netherlands without sponsorship.",
      },
      provenance: { kind: "owner", statement: "Synthetic browser-test authorization." },
      expiresOn: "2028-01-01",
    });

  const refreshed = await json("/v1/candidate");
  const current = refreshed.authorization;
  const base = current ?? {
    revision: 0,
    mode: "auto_submit",
    roleTerms: ["Engineer"],
    countries: ["NL"],
    blockedEmployerIds: [] as string[],
    dailyLimit: 5,
    allowAccountCreation: false,
    allowOptionalDisclosures: false,
    sponsorshipWording: null,
    salary: null,
    salaryNegotiable: null,
    effectiveAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    autoSubmitAcknowledged: true,
  };
  const profile = await json("/v1/candidate/profile", { expectedRevision: refreshed.revision });
  await json("/v1/candidate/authorization", {
    expectedRevision: base.revision,
    mode: base.mode,
    profileVersionId: profile.id,
    roleTerms: base.roleTerms,
    countries: base.countries,
    blockedEmployerIds: base.blockedEmployerIds,
    dailyLimit: base.dailyLimit,
    allowAccountCreation: base.allowAccountCreation,
    allowOptionalDisclosures: base.allowOptionalDisclosures,
    sponsorshipWording: base.sponsorshipWording,
    salary: base.salary,
    salaryNegotiable: base.salaryNegotiable,
    effectiveAt: base.effectiveAt,
    expiresAt: base.expiresAt,
    autoSubmitAcknowledged: base.autoSubmitAcknowledged,
  });
  return { profileId: profile.id as string };
}
