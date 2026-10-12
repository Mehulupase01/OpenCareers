import { expect, it } from "vitest";
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

it("captures resolved listing provenance conservatively without prompts or classification", async () => {
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
