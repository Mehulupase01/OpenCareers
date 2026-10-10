import { type DefaultTreeAdapterTypes, parse } from "parse5";
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
  id: z.string().regex(/^[a-f0-9]{12}$/),
  friendly_id: z.string().regex(/^[a-f0-9]{12}(?:-[a-zA-Z0-9_-]{1,180})?$/),
  name: z.string().min(1).max(240),
  url: z.url().max(2000),
  published_date: z.string().max(80).optional(),
  company: z.object({ friendly_id: z.string().max(63) }),
  location: z.object({
    name: z.string().max(240),
    country: z.object({ id: z.string().regex(/^[A-Z]{2}$/) }),
    is_remote: z.boolean().optional(),
  }),
});
const detail = z.object({
  "@type": z.literal("JobPosting"),
  url: z.url().max(2000),
  title: z.string().min(1).max(240),
  description: z.string().min(30).max(200000),
  hiringOrganization: z.object({ sameAs: z.url().max(2000) }),
});

export function breezyDescription(
  html: string,
  source: DiscoverySource,
  item: z.infer<typeof posting>,
) {
  if (Buffer.byteLength(html) > 8 * 1024 * 1024) throw new Error("Oversized vacancy page.");
  const tree = parse(html);
  const stack: DefaultTreeAdapterTypes.Node[] = [tree];
  const found: unknown[] = [];
  let nodes = 0;
  // Parse inert HTML; never execute portal scripts or request their resources.
  while (stack.length) {
    const node = stack.pop();
    if (!node || ++nodes > 100000) throw new Error("Vacancy document exceeds bounds.");
    if (
      "tagName" in node &&
      node.tagName === "script" &&
      node.attrs.some((a) => a.name === "type" && a.value.toLowerCase() === "application/ld+json")
    ) {
      const value: unknown = JSON.parse(
        node.childNodes.map((n) => ("value" in n ? n.value : "")).join(""),
      );
      if (value && typeof value === "object" && "@type" in value && value["@type"] === "JobPosting")
        found.push(value);
    }
    if ("childNodes" in node) stack.push(...node.childNodes);
  }
  if (found.length !== 1) throw new Error("Missing or ambiguous JobPosting evidence.");
  const data = detail.parse(found[0]);
  const target = recognizeUrl(data.url);
  const organization = new URL(data.hiringOrganization.sameAs);
  if (
    target.connector !== "breezy" ||
    target.board !== source.board ||
    target.postingId !== item.friendly_id ||
    data.title !== item.name ||
    organization.origin !== `https://${source.board}.breezy.hr` ||
    organization.username ||
    organization.password
  )
    throw new Error("Vacancy detail identity drifted.");
  return plainText(data.description);
}

export async function pollBreezySource(
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
  let bytes = 0;
  const get = async (url: string) => {
    if (signal.aborted || batch.pages.length >= 200)
      throw new DiscoveryFailure("unavailable", "Public board exceeds bounded scan capacity.");
    if (batch.pages.length) await delay(250);
    if (signal.aborted)
      throw new DiscoveryFailure("unavailable", "Source scan time limit exceeded.");
    const response = await read(url, null, signal);
    batch.pages.push(pageEvidence(url, response, new Date()));
    bytes += Buffer.byteLength(response.body);
    if (bytes > 32 * 1024 * 1024)
      throw new DiscoveryFailure("parser_failed", "Source scan exceeds storage bounds.");
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
    return response.body;
  };
  try {
    const listUrl = `https://${source.board}.breezy.hr/json`;
    const initial = await get(listUrl);
    const list = z.array(posting).max(198).parse(JSON.parse(initial));
    const seen = new Set<string>();
    for (const item of list) {
      const target = recognizeUrl(item.url);
      if (
        item.company.friendly_id !== source.board ||
        target.connector !== "breezy" ||
        target.board !== source.board ||
        target.postingId !== item.friendly_id ||
        !item.friendly_id.startsWith(item.id) ||
        seen.has(item.id)
      )
        throw new Error("Invalid public listing identity.");
      seen.add(item.id);
      const html = await get(target.canonicalUrl);
      const description = breezyDescription(html, source, item);
      const requisitionId = `${sourceKey(source)}:posting:${item.id}`;
      batch.jobs.push(
        normalizedJobSchema.parse({
          id: digest(`${source.employerId}:${requisitionId}`),
          employerId: source.employerId,
          requisitionId,
          title: item.name,
          company: source.company,
          location: item.location.name || "Unknown",
          ...locationFields(
            item.location.name,
            item.location.country.id,
            item.location.is_remote ? "remote" : undefined,
          ),
          url: target.canonicalUrl,
          canonicalUrl: target.canonicalUrl,
          postingId: item.id,
          providerRequisition: null,
          description,
          source: "breezy",
          synthetic: source.mode === "fixture",
          postedAt: normalizedDate(item.published_date),
          updatedAt: null,
          roleFamily: roleFamily(item.name),
          evidence: {
            page: batch.pages.length - 1,
            locator: "script[type=application/ld+json]:JobPosting",
          },
        }),
      );
    }
    // No count/snapshot token is published. Reject list movement during the detail scan.
    if ((await get(listUrl)) !== initial) throw new Error("Public job list changed during scan.");
    return batch;
  } catch (error) {
    const failure =
      error instanceof DiscoveryFailure
        ? error
        : new DiscoveryFailure("parser_failed", "Public listing or vacancy evidence was invalid.");
    failure.pages = batch.pages;
    throw failure;
  }
}
