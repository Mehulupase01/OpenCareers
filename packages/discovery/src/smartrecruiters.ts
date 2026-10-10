import { z } from "zod";
import {
  type DiscoveryBatch,
  type DiscoverySource,
  normalizedJobSchema,
} from "../../contracts/src/discovery.js";
import {
  digest,
  locationFields,
  normalizedDate,
  plainText,
  recognizeUrl,
  roleFamily,
  sourceKey,
} from "./normalize.js";
import { DiscoveryFailure, pageEvidence, type ReadPublic, retryAfter } from "./transport.js";

const posting = z.object({
  id: z.string().regex(/^[1-9][0-9]{0,17}$/),
  name: z.string().min(1).max(240),
  company: z.object({ identifier: z.string().min(1).max(100) }),
});
const section = z.object({ title: z.string().max(1000), text: z.string().max(200000) });
const detail = posting.extend({
  active: z.literal(true),
  postingUrl: z.url().max(2000),
  refNumber: z.string().max(180).optional(),
  releasedDate: z.string().max(80).optional(),
  location: z.object({
    city: z.string().max(240).optional(),
    country: z
      .string()
      .regex(/^[a-zA-Z]{2}$/)
      .optional(),
    remote: z.boolean().optional(),
  }),
  jobAd: z.object({
    sections: z.object({
      jobDescription: section,
      companyDescription: section.optional(),
      qualifications: section.optional(),
      additionalInformation: section.optional(),
    }),
  }),
});
const list = z.object({
  limit: z.literal(100),
  offset: z.number().int().min(0),
  totalFound: z.number().int().min(0).max(10000),
  content: z.array(posting).max(100),
});

export function normalizeSmartPage(raw: unknown, source: DiscoverySource, page: number) {
  const data = detail.parse(raw);
  const target = recognizeUrl(data.postingUrl);
  if (
    data.company.identifier !== source.board ||
    target.connector !== "smartrecruiters" ||
    target.board !== source.board ||
    target.postingId !== data.id
  )
    throw new Error("Posting left the configured company or identity.");
  const requisitionId = `${sourceKey(source)}:posting:${data.id}`;
  const location =
    [data.location.city, data.location.country?.toUpperCase()].filter(Boolean).join(", ") ||
    "Unknown";
  const sections = data.jobAd.sections;
  const job = normalizedJobSchema.parse({
    id: digest(`${source.employerId}:${requisitionId}`),
    employerId: source.employerId,
    requisitionId,
    title: data.name,
    company: source.company,
    location,
    ...locationFields(location, data.location.country, data.location.remote ? "remote" : undefined),
    url: data.postingUrl,
    canonicalUrl: target.canonicalUrl,
    postingId: data.id,
    providerRequisition: data.refNumber ?? null,
    description: [
      sections.companyDescription,
      sections.jobDescription,
      sections.qualifications,
      sections.additionalInformation,
    ]
      .filter((block) => block !== undefined)
      .map((block) => [plainText(block.title), plainText(block.text)].join("\n"))
      .join("\n\n"),
    source: "smartrecruiters",
    synthetic: source.mode === "fixture",
    postedAt: normalizedDate(data.releasedDate),
    updatedAt: null,
    roleFamily: roleFamily(data.name),
    evidence: { page, locator: "$" },
  });
  return { jobs: [job], size: 1 };
}

export async function pollSmartSource(
  source: DiscoverySource,
  read: ReadPublic,
  delay: (ms: number) => Promise<unknown>,
): Promise<DiscoveryBatch> {
  const batch: DiscoveryBatch = {
    jobs: [],
    pages: [],
    warnings: [],
    notModified: false,
    etag: null,
  };
  const signal = AbortSignal.timeout(60000);
  const base = `https://api.smartrecruiters.com/v1/companies/${source.board}/postings`;
  const seen = new Set<string>();
  let bytes = 0;
  let total: number | undefined;
  const get = async (url: string) => {
    if (signal.aborted || batch.pages.length >= 200)
      throw new DiscoveryFailure(
        "unavailable",
        "Public board exceeds bounded scan capacity; snapshot incomplete.",
      );
    if (batch.pages.length) await delay(250);
    if (signal.aborted)
      throw new DiscoveryFailure("unavailable", "Source scan time limit exceeded.");
    const response = await read(url, null, signal);
    bytes += Buffer.byteLength(response.body);
    if (bytes > 32 * 1024 * 1024)
      throw new DiscoveryFailure("parser_failed", "Source scan exceeds storage bounds.");
    batch.pages.push(pageEvidence(url, response, new Date()));
    if (signal.aborted)
      throw new DiscoveryFailure("unavailable", "Source scan time limit exceeded.");
    if (response.status === 403)
      throw new DiscoveryFailure("forbidden", "Source denied public access.");
    if (response.status === 429)
      throw new DiscoveryFailure(
        "rate_limited",
        "Source requested backoff.",
        retryAfter(response.retryAfter, Date.now()),
      );
    if (response.status !== 200)
      throw new DiscoveryFailure("unavailable", `Source returned HTTP ${response.status}.`);
    return JSON.parse(response.body) as unknown;
  };
  try {
    for (let offset = 0; offset < 10000; offset += 100) {
      const data = list.parse(await get(`${base}?destination=PUBLIC&limit=100&offset=${offset}`));
      total ??= data.totalFound;
      if (
        data.offset !== offset ||
        data.totalFound !== total ||
        data.content.length !== Math.min(100, Math.max(0, total - offset))
      )
        throw new Error("Pagination changed or returned an incomplete page.");
      for (const item of data.content) {
        if (item.company.identifier !== source.board || seen.has(item.id))
          throw new Error("Company or identity drifted.");
        seen.add(item.id);
        // Construct fixed-origin detail URLs; never follow an untrusted ref/apply URL.
        const page = batch.pages.length;
        const normalized = normalizeSmartPage(await get(`${base}/${item.id}`), source, page);
        if (normalized.jobs[0]?.postingId !== item.id) throw new Error("Detail identity changed.");
        const job = normalized.jobs[0];
        if (job) {
          if (job.description.trim().length < 30)
            batch.warnings.push(`Empty or very short description: ${item.id}`);
          batch.jobs.push(job);
        }
      }
      if (seen.size === total) return batch;
    }
    throw new Error("Source pagination limit reached before completion.");
  } catch (error) {
    const failure =
      error instanceof DiscoveryFailure
        ? error
        : new DiscoveryFailure(
            "parser_failed",
            "Public posting schema, identity or pagination was invalid.",
          );
    failure.pages = batch.pages;
    throw failure;
  }
}
