import { describe, expect, it } from "vitest";
import { normalizeReleaseSbom } from "../../scripts/release-sbom-validation.js";
import { nativeReleaseSbomFixture, releaseSbomManifest } from "../fixtures/release-sbom.js";

const lock = Buffer.from("synthetic release lock");
describe("release SBOM constraints", () => {
  it("normalizes deterministic public inventory and binds runtime inputs, not build scripts", () => {
    const input = nativeReleaseSbomFixture();
    const output = normalizeReleaseSbom(
      {
        ...input,
        serialNumber: "synthetic-varying-serial",
        metadata: {
          ...input.metadata,
          timestamp: new Date().toISOString(),
          authors: [{ name: "NOT_PUBLIC_INPUT" }],
        },
      },
      releaseSbomManifest,
      lock,
    );
    expect(output).toEqual(
      normalizeReleaseSbom(
        input,
        { ...releaseSbomManifest, scripts: { start: "different bundled script" } },
        lock,
      ),
    );
    expect(JSON.stringify(output)).not.toContain("NOT_PUBLIC_INPUT");
    expect(normalizeReleaseSbom(output, releaseSbomManifest, lock, true)).toEqual(output);
    expect(() =>
      normalizeReleaseSbom(output, releaseSbomManifest, Buffer.from("other lock"), true),
    ).toThrow("stale");
  });
  it("rejects unbound and mismatched application inputs", () => {
    expect(() =>
      normalizeReleaseSbom(nativeReleaseSbomFixture(), releaseSbomManifest, lock, true),
    ).toThrow("stale");
    expect(() =>
      normalizeReleaseSbom(
        nativeReleaseSbomFixture(),
        { ...releaseSbomManifest, name: "other-app" },
        lock,
      ),
    ).toThrow("identity");
    expect(() =>
      normalizeReleaseSbom(
        nativeReleaseSbomFixture(),
        { ...releaseSbomManifest, dependencies: { yazl: "3.3.2" } },
        lock,
      ),
    ).toThrow("runtime manifest");
    expect(() =>
      normalizeReleaseSbom(
        nativeReleaseSbomFixture(),
        { ...releaseSbomManifest, dependencies: {} },
        lock,
      ),
    ).toThrow("runtime manifest");
  });
  it.each([
    "https://unreviewed.example/yazl.tgz",
    "https://private:credential@registry.npmjs.org/yazl/-/yazl-3.3.1.tgz",
    "https://registry.npmjs.org/other/-/other-3.3.1.tgz",
  ])("rejects inappropriate distribution %s", (url) => {
    const input = nativeReleaseSbomFixture();
    const component = input.components[0];
    if (!component?.externalReferences[0]) throw new Error("Missing synthetic component.");
    component.externalReferences[0].url = url;
    expect(() => normalizeReleaseSbom(input, releaseSbomManifest, lock)).toThrow(
      "public npm registry",
    );
  });
  it("rejects malformed distribution hashes and component identities", () => {
    const input = nativeReleaseSbomFixture();
    const component = input.components[0];
    if (!component?.externalReferences[0]?.hashes[0])
      throw new Error("Missing synthetic checksum.");
    component.externalReferences[0].hashes[0].content = "a";
    expect(() => normalizeReleaseSbom(input, releaseSbomManifest, lock)).toThrow("checksum");
    component.purl = "pkg:npm/other@3.3.1";
    expect(() => normalizeReleaseSbom(input, releaseSbomManifest, lock)).toThrow("identities");
  });
  it("rejects missing, duplicate and unreachable graph references", () => {
    const input = nativeReleaseSbomFixture();
    input.dependencies.push({ ref: "pkg:npm/missing@1.0.0", dependsOn: [] });
    expect(() => normalizeReleaseSbom(input, releaseSbomManifest, lock)).toThrow("references");
    input.dependencies.pop();
    const dependency = input.dependencies[1];
    if (!dependency) throw new Error("Missing synthetic graph node.");
    input.dependencies.push(dependency);
    expect(() => normalizeReleaseSbom(input, releaseSbomManifest, lock)).toThrow("references");
    input.dependencies.pop();
    input.dependencies.pop();
    expect(() => normalizeReleaseSbom(input, releaseSbomManifest, lock)).toThrow("omits");
    const unreachable = nativeReleaseSbomFixture();
    const root = unreachable.dependencies[0];
    if (!root) throw new Error("Missing synthetic root.");
    root.dependsOn = [];
    expect(() =>
      normalizeReleaseSbom(unreachable, { ...releaseSbomManifest, dependencies: {} }, lock),
    ).toThrow("unreachable");
  });
});
