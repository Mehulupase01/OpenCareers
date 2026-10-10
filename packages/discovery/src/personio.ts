import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { type DiscoverySource, normalizedJobSchema } from "../../contracts/src/discovery.js";
import {
  digest,
  hostedUrl,
  locationFields,
  plainText,
  roleFamily,
  sourceKey,
} from "./normalize.js";

const position = z.object({
  id: z.string().regex(/^[1-9][0-9]{0,17}$/),
  name: z.string().trim().min(1).max(240),
  office: z.string().max(240).optional(),
  jobDescriptions: z
    .object({
      jobDescription: z
        .array(
          z.object({
            name: z.string().max(1000),
            value: z.string().max(200000),
          }),
        )
        .max(100),
    })
    .optional(),
});

export function normalizePersonio(raw: unknown, source: DiscoverySource, page: number) {
  if (
    typeof raw !== "string" ||
    Buffer.byteLength(raw) > 8 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(raw) ||
    XMLValidator.validate(raw) !== true
  )
    throw new Error("Unsafe or malformed public XML feed.");
  const parsed = new XMLParser({
    parseTagValue: false,
    processEntities: true,
    maxNestedTags: 30,
    ignoreDeclaration: true,
    isArray: (name) => name === "position" || name === "jobDescription",
  }).parse(raw);
  // Only the documented root can prove an empty complete snapshot.
  const root = z
    .object({
      "workzag-jobs": z.union([
        z.literal(""),
        z.object({ position: z.array(position).max(10000).default([]) }).strict(),
      ]),
    })
    .strict()
    .parse(parsed)["workzag-jobs"];
  const positions = root === "" ? [] : root.position;
  const jobs = positions.map((job, index) => {
    const requisitionId = `${sourceKey(source)}:position:${job.id}`;
    const url = hostedUrl(source, job.id);
    const location = job.office || "Unknown";
    return normalizedJobSchema.parse({
      id: digest(`${source.employerId}:${requisitionId}`),
      employerId: source.employerId,
      requisitionId,
      title: job.name,
      company: source.company,
      location,
      ...locationFields(location),
      url,
      canonicalUrl: url,
      postingId: job.id,
      providerRequisition: job.id,
      description: (job.jobDescriptions?.jobDescription ?? [])
        .map((block) => [plainText(block.name), plainText(block.value)].filter(Boolean).join("\n"))
        .join("\n\n"),
      source: "personio",
      synthetic: source.mode === "fixture",
      postedAt: null,
      updatedAt: null,
      roleFamily: roleFamily(job.name),
      evidence: { page, locator: `workzag-jobs.position[${index}]` },
    });
  });
  return { jobs, size: positions.length };
}
