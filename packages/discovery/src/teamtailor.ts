import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { type DiscoverySource, normalizedJobSchema } from "../../contracts/src/discovery.js";
import {
  digest,
  locationFields,
  normalizedDate,
  plainText,
  recognizeUrl,
  roleFamily,
  sourceKey,
} from "./normalize.js";

const item = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(200000),
  link: z.url().max(2000),
  pubDate: z.string().max(100).optional(),
  guid: z.string().min(1).max(180),
  remoteStatus: z.string().max(80).optional(),
  "tt:locations": z
    .object({
      "tt:location": z
        .array(
          z.object({
            "tt:name": z.string().max(240).optional(),
            "tt:city": z.string().max(240).optional(),
            "tt:country": z.string().max(240).optional(),
          }),
        )
        .max(100),
    })
    .optional(),
});
export function normalizeTeamtailor(raw: unknown, source: DiscoverySource, page: number) {
  if (
    typeof raw !== "string" ||
    Buffer.byteLength(raw) > 8 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(raw) ||
    XMLValidator.validate(raw) !== true
  )
    throw new Error("Unsafe or malformed public RSS.");
  const parsed = new XMLParser({
    parseTagValue: false,
    processEntities: true,
    maxNestedTags: 30,
    ignoreDeclaration: true,
    isArray: (name) => name === "item" || name === "tt:location",
  }).parse(raw);
  const channel = z
    .object({
      rss: z.object({
        channel: z
          .object({
            title: z.string().max(240),
            description: z.string().max(200000).optional(),
            link: z.url().max(2000),
            item: z.array(item).max(100).default([]),
          })
          .strict(),
      }),
    })
    .strict()
    .parse(parsed).rss.channel;
  const origin = new URL(channel.link);
  if (
    origin.protocol !== "https:" ||
    origin.host !== `${source.board}.teamtailor.com` ||
    origin.username ||
    origin.password
  )
    throw new Error("RSS channel left the configured tenant.");
  const guids = new Set<string>();
  const jobs = channel.item.map((job, index) => {
    if (guids.has(job.guid)) throw new Error("RSS repeated a global ID.");
    guids.add(job.guid);
    const target = recognizeUrl(job.link);
    if (target.connector !== "teamtailor" || target.board !== source.board)
      throw new Error("RSS job left the configured tenant.");
    const primary = job["tt:locations"]?.["tt:location"][0];
    const location =
      [primary?.["tt:city"] || primary?.["tt:name"], primary?.["tt:country"]]
        .filter(Boolean)
        .join(", ") || "Unknown";
    const remote =
      job.remoteStatus === "fully" || job.remoteStatus === "remote"
        ? "remote"
        : job.remoteStatus === "hybrid"
          ? "hybrid"
          : undefined;
    const requisitionId = `${sourceKey(source)}:posting:${target.postingId}`;
    return normalizedJobSchema.parse({
      id: digest(`${source.employerId}:${requisitionId}`),
      employerId: source.employerId,
      requisitionId,
      title: job.title,
      company: source.company,
      location,
      ...locationFields(location, undefined, remote),
      url: job.link,
      canonicalUrl: target.canonicalUrl,
      postingId: target.postingId,
      providerRequisition: null,
      description: plainText(job.description),
      source: "teamtailor",
      synthetic: source.mode === "fixture",
      postedAt: normalizedDate(job.pubDate),
      updatedAt: null,
      roleFamily: roleFamily(job.title),
      evidence: { page, locator: `rss.channel.item[${index}]` },
    });
  });
  return { jobs, size: channel.item.length };
}
