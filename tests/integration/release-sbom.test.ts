import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { normalizeReleaseSbom } from "../../scripts/release-sbom-validation.js";

it("validates the pinned pnpm production dependency inventory without reading owner configuration", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const args = [
    "pnpm",
    "sbom",
    "--prod",
    "--lockfile-only",
    "--sbom-format",
    "cyclonedx",
    "--sbom-spec-version",
    "1.6",
    "--sbom-type",
    "application",
  ];
  const raw =
    process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/s", "/c", `corepack ${args.join(" ")}`], {
          cwd: root,
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        })
      : execFileSync("corepack", args, { cwd: root, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const lockfile = await readFile(resolve(root, "pnpm-lock.yaml"));
  const bom = normalizeReleaseSbom(JSON.parse(raw.toString()), manifest, lockfile);
  expect(bom.metadata.component.name).toBe(manifest.name);
  expect(bom.components.length).toBeGreaterThan(Object.keys(manifest.dependencies).length);
  expect(bom.dependencies).toHaveLength(bom.components.length + 1);
  expect(normalizeReleaseSbom(bom, manifest, lockfile, true)).toEqual(bom);
});
