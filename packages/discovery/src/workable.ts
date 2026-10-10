import { z } from "zod";
import { type DiscoverySource, normalizedJobSchema } from "../../contracts/src/discovery.js";
import {
  digest,
  hostedUrl,
  locationFields,
  normalizedDate,
  plainText,
  roleFamily,
  sourceKey,
} from "./normalize.js";

const posting = z.object({
  title: z.string().min(1).max(240),
  shortcode: z.string().regex(/^[A-Z0-9]{1,30}$/),
  url: z.url().max(2000),
  description: z.string().max(200000),
  code: z.string().max(180).nullable().optional(),
  city: z.string().max(240).optional(),
  country: z.string().max(240).optional(),
  telecommuting: z.boolean().optional(),
  published_on: z.iso.date().optional(),
  locations: z
    .array(
      z.object({
        country: z.string().max(240).optional(),
        countryCode: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        city: z.string().max(240).optional(),
        hidden: z.boolean().optional(),
      }),
    )
    .max(100)
    .optional(),
});
export function normalizeWorkable(raw: unknown, source: DiscoverySource, page: number) {
  const data = z
    .object({ name: z.string().min(1).max(240), jobs: z.array(posting).max(10000) })
    .parse(raw);
  const jobs = data.jobs.map((job, index) => {
    const target = new URL(job.url);
    const paths = [`/j/${job.shortcode}`, `/${source.board}/j/${job.shortcode}`];
    if (
      target.protocol !== "https:" ||
      target.hostname !== "apply.workable.com" ||
      target.port ||
      target.username ||
      target.password ||
      !paths.includes(target.pathname.replace(/\/$/, ""))
    )
      throw new Error("Published job URL left its account/identity.");
    const primary = job.locations?.find((location) => !location.hidden);
    const visible = job.locations?.length ? primary : job;
    const location = [visible?.city, visible?.country].filter(Boolean).join(", ") || "Unknown";
    const url = hostedUrl(source, job.shortcode);
    const requisitionId = `${sourceKey(source)}:shortcode:${job.shortcode}`;
    return normalizedJobSchema.parse({
      id: digest(`${source.employerId}:${requisitionId}`),
      employerId: source.employerId,
      requisitionId,
      title: job.title,
      company: source.company,
      location,
      ...locationFields(location, primary?.countryCode, job.telecommuting ? "remote" : undefined),
      url,
      canonicalUrl: url,
      postingId: job.shortcode,
      providerRequisition: job.code?.trim() || null,
      description: plainText(job.description),
      source: "workable",
      synthetic: source.mode === "fixture",
      postedAt: normalizedDate(job.published_on),
      updatedAt: null,
      roleFamily: roleFamily(job.title),
      evidence: { page, locator: `jobs[${index}]` },
    });
  });
  return { jobs, size: data.jobs.length };
}
