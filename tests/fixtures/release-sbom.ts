export const releaseSbomManifest = {
  name: "synthetic-fixture",
  version: "0.1.0",
  packageManager: "pnpm@12.4.2",
  dependencies: { yazl: "3.3.1" },
};
export function nativeReleaseSbomFixture() {
  const root = "pkg:npm/synthetic-fixture@0.1.0",
    dependency = "pkg:npm/yazl@3.3.1";
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "synthetic-fixture",
        version: "0.1.0",
        purl: root,
        "bom-ref": root,
      },
      tools: { components: [{ type: "application", name: "pnpm", version: "12.4.2" }] },
    },
    components: [
      {
        type: "library",
        name: "yazl",
        version: "3.3.1",
        purl: dependency,
        "bom-ref": dependency,
        externalReferences: [
          {
            type: "distribution",
            url: "https://registry.npmjs.org/yazl/-/yazl-3.3.1.tgz",
            hashes: [{ alg: "SHA-512", content: "a".repeat(128) }],
          },
        ],
      },
    ],
    dependencies: [
      { ref: root, dependsOn: [dependency] },
      { ref: dependency, dependsOn: [] as string[] },
    ],
  };
}
