import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { submissionCohortMetadataSchema } from "../../packages/contracts/src/cohort.js";
import type { SqlExecutor } from "../../packages/persistence/src/database.js";
import { captureSubmissionMetadata } from "../../packages/persistence/src/submission-metadata.js";
import { documentJob } from "../fixtures/document-packets.js";

const listing = (id: string, roleFamily: string | null) => ({
  ...documentJob,
  id,
  roleFamily,
  postingId: id,
  providerRequisition: null,
  canonicalUrl: documentJob.url,
  city: null,
  remote: "unknown",
  postedAt: null,
  updatedAt: null,
  evidence: { page: 0, locator: "synthetic" },
});
const database = (listings: unknown[], job = documentJob) =>
  ({
    dialect: "sqlite",
    query: async (sql: string) =>
      sql.includes("FROM jobs") ? [{ data: JSON.stringify(job) }] : listings,
  }) as SqlExecutor;

it("captures resolved listing provenance conservatively within its attribution and read bounds", async () => {
  const first = {
    original_job_id: "original-listing",
    data: JSON.stringify(listing("original-listing", "engineering")),
  };
  const result = await captureSubmissionMetadata(
    database([first]),
    "synthetic-owner",
    documentJob.id,
  );
  expect(result).toMatchObject({
    source: documentJob.source,
    roleFamily: "engineering",
    jobId: documentJob.id,
  });
  const second = {
    original_job_id: "other-listing",
    data: JSON.stringify(listing("other-listing", "design")),
  };
  expect(
    await captureSubmissionMetadata(database([first, second]), "synthetic-owner", documentJob.id),
  ).toMatchObject({ roleFamily: "unknown" });
  await expect(
    captureSubmissionMetadata(
      database([{ ...first, original_job_id: "misbound" }]),
      "synthetic-owner",
      documentJob.id,
    ),
  ).rejects.toMatchObject({ code: "STATE_INVALID" });
  await expect(
    captureSubmissionMetadata(database(Array(101).fill(first)), "synthetic-owner", documentJob.id),
  ).rejects.toMatchObject({ code: "STATE_INVALID" });
});

const explicitJob = {
  ...documentJob,
  title: "Senior Software Engineer",
  description: "We offer visa sponsorship.",
};
const v2 = () => ({
  method: "frozen_job_at_intent_v2",
  jobId: documentJob.id,
  jobSha256: "a".repeat(64),
  source: documentJob.source,
  roleFamily: "unknown",
  synthetic: true,
  vacancySignals: {
    method: "explicit_vacancy_signals_v1",
    seniority: "senior",
    sponsorship: "explicitly_available",
    evidence: [
      { dimension: "seniority", field: "title", start: 0, end: 6, text: "Senior" },
      {
        dimension: "sponsorship",
        field: "description",
        start: 0,
        end: explicitJob.description.length,
        text: explicitJob.description,
      },
    ],
  },
});

it("freezes v2 signals and exact evidence from only the authoritative title and description", async () => {
  const conflictingListing = {
    original_job_id: "listing-only",
    data: JSON.stringify({
      ...listing("listing-only", "engineering"),
      title: "Junior Software Engineer",
      description: "We do not offer visa sponsorship.",
    }),
  };
  const tx = database([conflictingListing], explicitJob);
  const query = vi.spyOn(tx, "query");
  const result = await captureSubmissionMetadata(tx, "synthetic-owner", explicitJob.id);
  expect(result).toMatchObject({
    method: "frozen_job_at_intent_v2",
    jobId: explicitJob.id,
    jobSha256: createHash("sha256").update(JSON.stringify(explicitJob)).digest("hex"),
    roleFamily: "engineering",
    synthetic: true,
    vacancySignals: {
      method: "explicit_vacancy_signals_v1",
      seniority: "senior",
      sponsorship: "explicitly_available",
    },
  });
  const parsed = submissionCohortMetadataSchema.parse(result);
  if (parsed.method !== "frozen_job_at_intent_v2") throw new Error("Expected v2 metadata.");
  expect(parsed.vacancySignals.evidence.length).toBeGreaterThanOrEqual(2);
  expect(parsed.vacancySignals.evidence.length).toBeLessThanOrEqual(8);
  for (const dimension of ["seniority", "sponsorship"])
    expect(parsed.vacancySignals.evidence.some((span) => span.dimension === dimension)).toBe(true);
  for (const span of parsed.vacancySignals.evidence) {
    expect(Number.isInteger(span.start) && Number.isInteger(span.end)).toBe(true);
    expect(span.start).toBeGreaterThanOrEqual(0);
    expect(span.end).toBeGreaterThan(span.start);
    expect(span.end).toBeLessThanOrEqual(explicitJob[span.field].length);
    expect(explicitJob[span.field].slice(span.start, span.end)).toBe(span.text);
  }
  expect(query).toHaveBeenCalledTimes(2);
  expect(
    query.mock.calls.every(
      ([, params]) =>
        JSON.stringify(params) === JSON.stringify(["synthetic-owner", explicitJob.id]),
    ),
  ).toBe(true);
  expect(query.mock.calls.map(([sql]) => sql).join(" ")).not.toMatch(
    /assessment|candidate|profile/i,
  );
});

it.each([
  ["Intern Software Engineer", "intern"],
  ["Junior Software Engineer", "junior"],
  ["Mid-level Software Engineer", "mid"],
  ["Senior Software Engineer", "senior"],
  ["Lead Software Engineer", "lead"],
  ["Software Engineer", "unknown"],
  ["Junior / Senior Software Engineer", "unknown"],
])(
  "captures explicit title %s as %s without inferring from years or candidate gates",
  async (title, seniority) => {
    const result = await captureSubmissionMetadata(
      database([], {
        ...documentJob,
        title,
        description: "Requires 10 years of experience. Work authorization is required.",
      }),
      "synthetic-owner",
      documentJob.id,
    );
    expect(result).toMatchObject({ vacancySignals: { seniority, sponsorship: "unknown" } });
  },
);

it.each([
  ["We offer visa sponsorship.", "explicitly_available"],
  ["We do not offer visa sponsorship.", "explicitly_unavailable"],
  ["We may offer visa sponsorship depending on circumstances.", "unknown"],
  ["We offer visa sponsorship. We do not offer visa sponsorship.", "unknown"],
  ["Candidates must not require visa sponsorship.", "unknown"],
  ["Do you require visa sponsorship?", "unknown"],
  ["We build software for international customers.", "unknown"],
])("keeps employer sponsorship wording conservative: %s", async (description, sponsorship) => {
  expect(
    await captureSubmissionMetadata(
      database([], {
        ...documentJob,
        title: "Software Engineer",
        description,
      }),
      "synthetic-owner",
      documentJob.id,
    ),
  ).toMatchObject({
    vacancySignals: { seniority: "unknown", sponsorship },
  });
});

it("fails closed for missing, malformed and misbound authoritative job rows", async () => {
  const missing = { dialect: "sqlite", query: async () => [] } as unknown as SqlExecutor;
  await expect(captureSubmissionMetadata(missing, "owner", documentJob.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    captureSubmissionMetadata(
      database([], { ...documentJob, id: "other" }),
      "owner",
      documentJob.id,
    ),
  ).rejects.toMatchObject({ code: "STATE_INVALID" });
  await expect(
    captureSubmissionMetadata(database([], { ...documentJob, title: "" }), "owner", documentJob.id),
  ).rejects.toThrow();
});

it("preserves strict v1 parsing, JSON bytes and their checksum without adding signals", () => {
  const raw =
    '{"method":"frozen_job_at_intent_v1","jobId":"job-documents","jobSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source":"synthetic fixture","roleFamily":"unknown","synthetic":true}';
  const parsed = submissionCohortMetadataSchema.parse(JSON.parse(raw));
  expect(JSON.stringify(parsed)).toBe(raw);
  expect(createHash("sha256").update(JSON.stringify(parsed)).digest("hex")).toBe(
    createHash("sha256").update(raw).digest("hex"),
  );
  expect(parsed).not.toHaveProperty("vacancySignals");
  expect(
    submissionCohortMetadataSchema.safeParse({
      ...JSON.parse(raw),
      vacancySignals: v2().vacancySignals,
    }).success,
  ).toBe(false);
});

it("requires strict bounded v2 categories and well-formed evidence spans", () => {
  const valid = v2();
  expect(submissionCohortMetadataSchema.safeParse(valid).success).toBe(true);
  const span = valid.vacancySignals.evidence[0];
  const malformedSignals = [
    { ...valid.vacancySignals, method: "inferred_v1" },
    { ...valid.vacancySignals, seniority: "principal" },
    { ...valid.vacancySignals, sponsorship: "available" },
    { ...valid.vacancySignals, extra: true },
    { ...valid.vacancySignals, evidence: Array(9).fill(span) },
    ...[
      { ...span, start: -1 },
      { ...span, start: 0.5 },
      { ...span, end: 0 },
      { ...span, start: 7, end: 6 },
      { ...span, end: 7 },
      { ...span, text: "" },
      { ...span, dimension: "roleFamily" },
      { ...span, field: "assessment" },
      { ...span, quote: "Senior" },
    ].map((evidence) => ({ ...valid.vacancySignals, evidence: [evidence] })),
  ];
  for (const vacancySignals of malformedSignals)
    expect(submissionCohortMetadataSchema.safeParse({ ...valid, vacancySignals }).success).toBe(
      false,
    );
  const { vacancySignals: _, ...missing } = valid;
  expect(submissionCohortMetadataSchema.safeParse(missing).success).toBe(false);
  expect(submissionCohortMetadataSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
});
