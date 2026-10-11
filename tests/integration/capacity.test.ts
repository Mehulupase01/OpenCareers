import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { browserResources } from "../../packages/browser/src/resources.js";
import { capacityDirectorySize, capacityOptions, runCapacity } from "../../scripts/capacity-run.js";

describe("isolated synthetic capacity driver", () => {
  it("refuses private paths, external targets and unbounded workload options", async () => {
    for (const options of [
      { target: "https://jobs.example.com" },
      { profile: "local" },
      { dataDir: "synthetic-private-path" },
      { durationSeconds: 259201 },
      { sampleSeconds: 0 },
      { maxCycles: 217 },
    ]) {
      expect(() => capacityOptions.parse(options)).toThrow();
      await expect(runCapacity(options)).rejects.toThrow();
    }
  });

  it("rejects filesystem redirection and bounds traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencareers-capacity-bound-"));
    const outside = await mkdtemp(join(tmpdir(), "opencareers-capacity-outside-"));
    try {
      await writeFile(join(root, "synthetic.txt"), "fixture");
      expect(await capacityDirectorySize(root)).toEqual({ bytes: 7, files: 2 });
      await expect(capacityDirectorySize(root, 1)).rejects.toThrow("file count");
      await symlink(
        outside,
        join(root, "redirect"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(capacityDirectorySize(root)).rejects.toThrow("contains a link");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("executes a guarded mock cycle, releases resources and never labels a short run as a production soak", async () => {
    const result = await runCapacity({
      durationSeconds: 1,
      intervalSeconds: 1,
      sampleSeconds: 1,
      maxCycles: 1,
    });
    try {
      expect(result).toMatchObject({
        status: "finished",
        cycles: 1,
        stable: true,
        durationSatisfied: true,
        productionSoakGateSatisfied: false,
      });
      const report = (await readFile(result.report, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(report[0]).toMatchObject({
        liveSubmissions: false,
        realModelCalls: false,
        scope: "synthetic_capacity_harness",
      });
      expect(report.find((row) => row.kind === "cycle")).toMatchObject({
        scenario: "standard",
        outcome: "confirmed",
      });
      expect(report.filter((row) => row.kind === "sample").at(-1)).toMatchObject({
        flow: { confirmedWithReceipt: 1, confirmedWithoutReceipt: 0 },
        browser: { contexts: 0, browsers: 0 },
        memory: { scope: "node_driver_process_only" },
      });
      expect(browserResources.snapshot()).toMatchObject({
        contexts: 0,
        browsers: 0,
        openingContexts: 0,
        openingBrowsers: 0,
      });
    } finally {
      await rm(result.directory, { recursive: true, force: true });
    }
  }, 60000);

  it("records cancellation as interrupted rather than completed duration evidence", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runCapacity({ durationSeconds: 60 }, controller.signal);
    try {
      expect(result).toMatchObject({
        status: "interrupted",
        cycles: 0,
        durationSatisfied: false,
        productionSoakGateSatisfied: false,
      });
    } finally {
      await rm(result.directory, { recursive: true, force: true });
    }
  });
});
