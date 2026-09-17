import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import {
  type DiscoveryBatch,
  type DiscoverySource,
  type NormalizedJob,
  normalizedJobSchema,
} from "../../contracts/src/discovery.js";
import {
  digest,
  hostedUrl,
  locationFields,
  normalizedDate,
  plainText,
  roleFamily,
  sourceKey,
} from "./normalize.js";
import {
  DiscoveryFailure,
  pageEvidence,
  type ReadPublic,
  readPublic,
  retryAfter,
} from "./transport.js";

const text = z.string().max(200000);
const ghJob = z.object({
  id: z.number().int().positive(),
  internal_job_id: z.number().int().positive().nullable(),
  title: z.string().min(1).max(240),
  location: z.object({ name: z.string().max(240) }),
  content: text,
  requisition_id: z.string().max(180).nullable().optional(),
  updated_at: z.string().optional(),
  first_published: z.string().optional(),
});
const leverJob = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,180}$/),
  text: z.string().min(1).max(240),
  categories: z.object({ location: z.string().max(240).optional() }),
  country: z.string().nullable().optional(),
  descriptionPlain: text.optional(),
  description: text.optional(),
  lists: z
    .array(z.object({ text: z.string().max(1000), content: text }))
    .max(100)
    .optional(),
  additionalPlain: text.optional(),
  workplaceType: z.string().optional(),
  createdAt: z.number().optional(),
});

export function normalizePage(
  raw: unknown,
  source: DiscoverySource,
  page: number,
): { jobs: NormalizedJob[]; size: number } {
  const jobs: NormalizedJob[] = [];
  if (source.connector === "greenhouse") {
    const data = z
      .object({
        jobs: z.array(ghJob).max(10000),
        meta: z.object({ total: z.number().int().min(0) }).optional(),
      })
      .parse(raw);
    if (data.meta && data.meta.total !== data.jobs.length)
      throw new Error("Incomplete board snapshot.");
    for (const [index, job] of data.jobs.entries()) {
      if (job.internal_job_id === null) continue;
      const requisitionId = `${sourceKey(source)}:internal:${job.internal_job_id}`;
      const description = plainText(plainText(job.content));
      jobs.push(
        normalizedJobSchema.parse({
          id: digest(`${source.employerId}:${requisitionId}`),
          employerId: source.employerId,
          requisitionId,
          title: job.title,
          company: source.company,
          location: job.location.name || "Unknown",
          ...locationFields(job.location.name),
          url: hostedUrl(source, String(job.id)),
          canonicalUrl: hostedUrl(source, String(job.id)),
          postingId: String(job.id),
          providerRequisition: job.requisition_id ?? null,
          description,
          source: source.connector,
          synthetic: source.mode === "fixture",
          postedAt: normalizedDate(job.first_published),
          updatedAt: normalizedDate(job.updated_at),
          roleFamily: roleFamily(job.title),
          evidence: { page, locator: `jobs[${index}]` },
        }),
      );
    }
    return { jobs, size: data.jobs.length };
  }
  const data = z.array(leverJob).max(100).parse(raw);
  for (const [index, job] of data.entries()) {
    const requisitionId = `${sourceKey(source)}:${job.id}`;
    const description = [
      job.descriptionPlain ?? plainText(job.description ?? ""),
      ...(job.lists ?? []).map((list) => `${list.text}\n${plainText(list.content)}`),
      job.additionalPlain ?? "",
    ]
      .join("\n\n")
      .trim();
    jobs.push(
      normalizedJobSchema.parse({
        id: digest(`${source.employerId}:${requisitionId}`),
        employerId: source.employerId,
        requisitionId,
        title: job.text,
        company: source.company,
        location: job.categories.location || "Unknown",
        ...locationFields(job.categories.location ?? "", job.country, job.workplaceType),
        url: hostedUrl(source, job.id),
        canonicalUrl: hostedUrl(source, job.id),
        postingId: job.id,
        providerRequisition: null,
        description,
        source: source.connector,
        synthetic: source.mode === "fixture",
        postedAt: normalizedDate(job.createdAt),
        updatedAt: null,
        roleFamily: roleFamily(job.text),
        evidence: { page, locator: `[${index}]` },
      }),
    );
  }
  return { jobs, size: data.length };
}

export async function pollSource(
  source: DiscoverySource,
  read: ReadPublic = readPublic,
  delay: (ms: number) => Promise<unknown> = setTimeout,
): Promise<DiscoveryBatch> {
  const result: DiscoveryBatch = {
    jobs: [],
    pages: [],
    warnings: [],
    notModified: false,
    etag: null,
  };
  const signal = AbortSignal.timeout(60000);
  const seen = new Set<string>();
  let totalBytes = 0;
  try {
    for (let page = 0; page < 100; page++) {
      if (signal.aborted)
        throw new DiscoveryFailure("unavailable", "Source scan time limit exceeded.");
      const url =
        source.connector === "greenhouse"
          ? `https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs?content=true`
          : `https://api.${source.region === "eu" ? "eu." : ""}lever.co/v0/postings/${source.board}?mode=json&skip=${page * 100}&limit=100`;
      const response = await read(
        url,
        source.connector === "greenhouse" ? source.etag : null,
        signal,
      );
      totalBytes += Buffer.byteLength(response.body);
      if (totalBytes > 32 * 1024 * 1024)
        throw new DiscoveryFailure("parser_failed", "Source scan exceeds storage bounds.");
      result.pages.push(pageEvidence(url, response, new Date()));
      if (response.status === 403)
        throw new DiscoveryFailure("forbidden", "Source denied public access.");
      if (response.status === 429)
        throw new DiscoveryFailure(
          "rate_limited",
          "Source requested backoff.",
          retryAfter(response.retryAfter, Date.now()),
        );
      if (response.status === 304 && source.connector === "greenhouse" && source.etag) {
        result.notModified = true;
        result.etag = source.etag;
        return result;
      }
      if (response.status !== 200)
        throw new DiscoveryFailure("unavailable", `Source returned HTTP ${response.status}.`);
      let normalized: ReturnType<typeof normalizePage>;
      try {
        normalized = normalizePage(JSON.parse(response.body), source, page);
      } catch {
        throw new DiscoveryFailure(
          "parser_failed",
          "Source schema or normalized data was invalid.",
        );
      }
      for (const job of normalized.jobs) {
        if (seen.has(job.postingId))
          throw new DiscoveryFailure(
            "parser_failed",
            "Repeated posting across pages; feed may have shifted.",
          );
        seen.add(job.postingId);
        if (job.description.trim().length < 30)
          result.warnings.push(`Empty or very short description: ${job.postingId}`);
        result.jobs.push(job);
      }
      if (source.connector === "greenhouse" || normalized.size < 100) {
        result.etag = source.connector === "greenhouse" ? response.etag : null;
        return result;
      }
      await delay(250);
    }
    throw new DiscoveryFailure(
      "parser_failed",
      "Source pagination limit reached before completion.",
    );
  } catch (error) {
    const failure =
      error instanceof DiscoveryFailure
        ? error
        : new DiscoveryFailure("unavailable", "Source scan failed.");
    failure.pages = result.pages;
    throw failure;
  }
}
