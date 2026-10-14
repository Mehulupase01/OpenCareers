import { createHash } from "node:crypto";
import { z } from "zod";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const nameSchema = z
  .string()
  .regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/)
  .max(214);
const versionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/)
  .max(200);
const manifestSchema = z.object({
  name: nameSchema,
  version: versionSchema,
  packageManager: z.literal("pnpm@12.4.2"),
  dependencies: z.record(nameSchema, z.string().min(1).max(200)),
  optionalDependencies: z.record(nameSchema, z.string().min(1).max(200)).default({}),
});
const identitySchema = z.object({
  type: z.enum(["application", "library"]),
  name: nameSchema,
  group: z
    .string()
    .regex(/^@[a-z0-9._-]+$/)
    .max(214)
    .optional(),
  version: versionSchema,
  purl: z.string().max(500),
  "bom-ref": z.string().max(500),
});
const componentSchema = identitySchema.extend({
  externalReferences: z
    .array(
      z.object({
        type: z.literal("distribution"),
        url: z.url().max(1000),
        hashes: z
          .array(
            z.object({
              alg: z.enum(["SHA-512", "SHA-256", "SHA-1"]),
              content: z
                .string()
                .regex(/^[a-f0-9]+$/)
                .max(128),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .min(1)
    .max(1),
});
const bomSchema = z.object({
  bomFormat: z.literal("CycloneDX"),
  specVersion: z.literal("1.6"),
  version: z.literal(1),
  metadata: z.object({
    component: identitySchema,
    tools: z.object({
      components: z
        .array(
          z.object({
            type: z.literal("application"),
            name: z.literal("pnpm"),
            version: z.literal("12.4.2"),
          }),
        )
        .length(1),
    }),
    properties: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  }),
  components: z.array(componentSchema).max(5000),
  dependencies: z
    .array(
      z.object({ ref: z.string().max(500), dependsOn: z.array(z.string().max(500)).max(5000) }),
    )
    .min(1)
    .max(5001),
});
const purl = (name: string, version: string) => `pkg:npm/${name.replace(/^@/, "%40")}@${version}`;
const fullName = (component: z.infer<typeof identitySchema>) =>
  component.group ? `${component.group}/${component.name}` : component.name;

export function normalizeReleaseSbom(
  raw: unknown,
  rawManifest: unknown,
  lockfile: Buffer,
  requireBinding = false,
) {
  const manifest = manifestSchema.parse(rawManifest);
  const bom = bomSchema.parse(raw);
  const root = bom.metadata.component;
  if (
    root.type !== "application" ||
    fullName(root) !== manifest.name ||
    root.version !== manifest.version
  )
    throw new Error("SBOM application identity does not match the release.");
  const identities = [root, ...bom.components];
  const references = new Map<string, typeof root>();
  for (const component of identities) {
    if (
      (component.group !== undefined && component.name.includes("/")) ||
      component.purl !== purl(fullName(component), component.version) ||
      component["bom-ref"] !== component.purl ||
      references.has(component["bom-ref"])
    )
      throw new Error("SBOM component identities are invalid or collide.");
    references.set(component["bom-ref"], component);
  }
  for (const component of bom.components) {
    if (component.type !== "library") throw new Error("Unexpected SBOM dependency type.");
    for (const reference of component.externalReferences) {
      const url = new URL(reference.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "registry.npmjs.org" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        decodeURIComponent(url.pathname) !==
          `/${fullName(component)}/-/${component.name.split("/").at(-1)}-${component.version}.tgz`
      )
        throw new Error("SBOM distribution must use the public npm registry.");
      for (const digest of reference.hashes)
        if (digest.content.length !== { "SHA-512": 128, "SHA-256": 64, "SHA-1": 40 }[digest.alg])
          throw new Error("SBOM distribution checksum is invalid.");
    }
  }
  const graph = new Map<string, string[]>();
  for (const dependency of bom.dependencies) {
    if (
      !references.has(dependency.ref) ||
      graph.has(dependency.ref) ||
      new Set(dependency.dependsOn).size !== dependency.dependsOn.length ||
      dependency.dependsOn.some((ref) => !references.has(ref))
    )
      throw new Error("SBOM graph contains missing or duplicate references.");
    graph.set(dependency.ref, dependency.dependsOn.sort());
  }
  if (graph.size !== references.size) throw new Error("SBOM graph omits dependency nodes.");
  const rootLinks = graph.get(root["bom-ref"]) ?? [];
  const declared = { ...manifest.dependencies, ...manifest.optionalDependencies };
  const direct = rootLinks.map((ref) => references.get(ref)).filter((item) => item !== undefined);
  if (
    direct.length !== Object.keys(declared).length ||
    new Set(direct.map((item) => fullName(item))).size !== direct.length ||
    direct.some(
      (item) =>
        !Object.hasOwn(declared, fullName(item)) ||
        (versionSchema.safeParse(declared[fullName(item)]).success &&
          declared[fullName(item)] !== item.version),
    )
  )
    throw new Error("SBOM root dependencies do not match the runtime manifest.");
  const visited = new Set<string>();
  const pending = [root["bom-ref"]];
  while (pending.length) {
    const ref = pending.pop();
    if (!ref || visited.has(ref)) continue;
    visited.add(ref);
    pending.push(...(graph.get(ref) ?? []));
  }
  if (visited.size !== references.size) throw new Error("SBOM contains unreachable dependencies.");
  const runtimeManifest = {
    ...manifest,
    dependencies: Object.fromEntries(Object.entries(manifest.dependencies).sort()),
    optionalDependencies: Object.fromEntries(Object.entries(manifest.optionalDependencies).sort()),
  };
  const properties = [
    { name: "opencareers:lockfile-sha256", value: hash(lockfile) },
    { name: "opencareers:runtime-manifest-sha256", value: hash(JSON.stringify(runtimeManifest)) },
    {
      name: "opencareers:inventory-scope",
      value: "declared-production-lockfile-all-optional-platforms",
    },
  ];
  if (requireBinding && JSON.stringify(bom.metadata.properties) !== JSON.stringify(properties))
    throw new Error("SBOM is stale or bound to another release input.");
  return {
    bomFormat: bom.bomFormat,
    specVersion: bom.specVersion,
    version: bom.version,
    metadata: {
      component: root,
      tools: bom.metadata.tools,
      lifecycles: [{ phase: "pre-build" }],
      properties,
    },
    components: bom.components.sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"])),
    dependencies: bom.dependencies.sort((a, b) => a.ref.localeCompare(b.ref)),
  };
}
