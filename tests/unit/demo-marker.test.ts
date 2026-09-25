import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ensureDemoMarker } from "../../packages/persistence/src/index.js";

it("initializes one synthetic marker across concurrent process startups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencareers-demo-marker-"));
  try {
    await Promise.all(Array.from({ length: 20 }, () => ensureDemoMarker(dir)));
    expect((await readFile(join(dir, ".synthetic-workspace"), "utf8")).trim()).toBe(
      "OpenCareers synthetic data v1",
    );
    await ensureDemoMarker(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects existing unmarked data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencareers-unknown-data-"));
  try {
    await mkdir(join(dir, "artifacts"));
    await expect(ensureDemoMarker(dir)).rejects.toThrow("Demo marker missing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
