import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleInputPaths } from "../../scripts/bundle-verification.js";
import { normalizeReleaseSbom } from "../../scripts/release-sbom-validation.js";
import { createServerBuildContext } from "../../scripts/server-context.js";
import { nativeReleaseSbomFixture, releaseSbomManifest } from "../fixtures/release-sbom.js";

describe("screened server build context", () => {
  let root: string;
  const outputs: string[] = [];
  beforeEach(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "opencareers-server-source-"));
    for (const path of [...bundleInputPaths, "dist/packages/contracts/src/index.js"]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(
        join(root, path),
        path === "package.json"
          ? JSON.stringify({ ...releaseSbomManifest, type: "module" })
          : "synthetic public fixture\n",
      );
      if (path.startsWith("dist/") && path.endsWith(".js")) {
        const source = path.replace(/^dist\//, "").replace(/\.js$/, ".ts");
        await mkdir(dirname(join(root, source)), { recursive: true });
        await writeFile(join(root, source), "synthetic source\n");
      }
    }
    await writeFile(
      join(root, "dist/release/sbom.cdx.json"),
      JSON.stringify(
        normalizeReleaseSbom(
          nativeReleaseSbomFixture(),
          releaseSbomManifest,
          await readFile(join(root, "pnpm-lock.yaml")),
        ),
      ),
    );
    await mkdir(join(root, "deploy/server"), { recursive: true });
    await writeFile(
      join(root, "deploy/server/Dockerfile"),
      await readFile("deploy/server/Dockerfile"),
    );
    await writeFile(join(root, ".env"), "PRIVATE_CONTEXT_SENTINEL");
    await mkdir(join(root, "private"));
    await writeFile(join(root, "private/candidate.txt"), "PRIVATE_CONTEXT_SENTINEL");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    for (const directory of outputs.splice(0))
      await rm(directory, { recursive: true, force: true });
  });
  it("extracts only screened compiled runtime and locked dependency inputs", async () => {
    const result = await createServerBuildContext(root);
    outputs.push(result.directory, result.bundleDirectory);
    const manifestBytes = await readFile(join(result.directory, "context-manifest.json"));
    expect(createHash("sha256").update(manifestBytes).digest("hex")).toBe(result.manifestSha256);
    const manifest = JSON.parse(manifestBytes.toString());
    expect(manifest.productionReleaseAccepted).toBe(false);
    expect(manifest.files).toHaveLength(result.files);
    for (const entry of manifest.files) {
      const bytes = await readFile(join(result.directory, entry.path));
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
      expect(bytes.toString()).not.toContain("PRIVATE_CONTEXT_SENTINEL");
      expect((await lstat(join(result.directory, entry.path))).isSymbolicLink()).toBe(false);
    }
    for (const path of [
      ".env",
      ".env.example",
      "private",
      "scripts/windows-runtime.ps1",
      "INSTALL.md",
      "apps",
      "tests",
      "node_modules",
    ])
      await expect(lstat(join(result.directory, path))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses credential-like Dockerfile bytes before any build", async () => {
    await writeFile(join(root, "deploy/server/Dockerfile"), `ENV KEY=sk-or-v1-${"f".repeat(40)}`);
    await expect(createServerBuildContext(root)).rejects.toThrow("privacy screening");
  });
  it("refuses non-regular Dockerfile inputs", async () => {
    await rm(join(root, "deploy/server/Dockerfile"));
    await mkdir(join(root, "deploy/server/Dockerfile"));
    await expect(createServerBuildContext(root)).rejects.toThrow("bounded regular");
  });
});

it("keeps the topology private, bounded, separately credentialed and fail-closed", async () => {
  const compose = JSON.parse(await readFile("deploy/server/compose.json", "utf8"));
  expect(compose.networks.data.internal).toBe(true);
  expect(compose.services.database.ports).toBeUndefined();
  expect(compose.services.database.networks).toEqual(["data"]);
  expect(compose.services.database.env_file[0].path).toContain("OPENCAREERS_POSTGRES_ENV");
  expect(compose.services.api.ports).toEqual(["127.0.0.1:4317:4317"]);
  expect(compose.services.worker.ports).toBeUndefined();
  expect(compose.services.worker.command).toEqual(["node", "dist/apps/worker/src/main.js"]);
  for (const service of [compose.services.api, compose.services.worker]) {
    expect(service.user).toBe("1000:1000");
    expect(service.read_only).toBe(true);
    expect(service.init).toBe(true);
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.security_opt).toEqual(["no-new-privileges:true"]);
    expect(service.environment.AUTOPILOT_EXTERNAL_SUBMISSION).toBe("false");
    expect(service.environment.AUTOPILOT_PROFILE).toBe("server");
    expect(service.environment.AUTOPILOT_DATABASE_URL).toBeUndefined();
    expect(service.env_file[0].path).toContain("OPENCAREERS_SERVER_ENV");
    expect(service.mem_limit).toBe("3g");
    expect(service.pids_limit).toBe(256);
    expect(service.logging.options["max-size"]).toBe("10m");
    expect(service.volumes).toEqual(["runtime:/var/lib/opencareers"]);
  }
  const dockerfile = await readFile("deploy/server/Dockerfile", "utf8");
  const nodeVersion = (await readFile(".node-version", "utf8")).trim();
  expect(dockerfile.match(/^FROM /gm)).toHaveLength(2);
  for (const line of dockerfile.split("\n").filter((line) => line.startsWith("FROM ")))
    expect(line).toMatch(
      new RegExp(
        `^FROM node:${nodeVersion.replaceAll(".", "\\.")}-bookworm-slim@sha256:[a-f0-9]{64} AS `,
      ),
    );
  expect(dockerfile).not.toMatch(/COPY\s+\.\s/);
  expect(dockerfile).toContain("pnpm install --prod --frozen-lockfile");
  expect(dockerfile).toContain("USER 1000:1000");
  expect(dockerfile).toContain("headers:{host}");
  expect(compose.services.worker.healthcheck.test.join(" ")).toContain("headers:{host}");
  expect(dockerfile).not.toContain("AUTOPILOT_OWNER_TOKEN");
});
