import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browserResources } from "../../packages/browser/src/resources.js";
import {
  launchDryRunBrowser,
  observeOwnedMockBrowsers,
} from "../../packages/browser/src/runtime.js";
import { startMockAts } from "../../packages/mock-ats/src/server.js";
import { runMonitoredCapacity } from "../../scripts/monitored-capacity-run.js";

it("records OS-owned browser lifecycle memory without qualifying a short source run", async () => {
  const result = await runMonitoredCapacity({
    durationSeconds: 1,
    intervalSeconds: 1,
    sampleSeconds: 1,
    maxCycles: 1,
  });
  try {
    if (result.status !== "finished") {
      // Only this fresh synthetic harness is retained; never collect process names or env.
      const evidence = join(process.cwd(), "test-results", "monitored-capacity");
      await mkdir(evidence, { recursive: true });
      for (const [name, path] of [
        ["capacity.jsonl", result.report],
        ["process-memory.jsonl", result.processMemoryReport],
      ] as const) {
        const bytes = await readFile(path);
        await writeFile(join(evidence, name), bytes);
      }
      console.error(
        JSON.stringify({
          status: result.status,
          cycles: result.cycles,
          stable: result.stable,
          resourceCollectionFailed: result.resourceCollectionFailed,
          processSamples: result.processSamples,
        }),
      );
    }
    expect(result).toMatchObject({
      status: "finished",
      cycles: 1,
      stable: true,
      durationSatisfied: true,
      resourceCollectionFailed: false,
      productionSoakGateSatisfied: false,
    });
    const records = (await readFile(result.processMemoryReport, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.some((record) => record.phase === "opened" && record.processCount > 1)).toBe(
      true,
    );
    expect(records.some((record) => record.phase === "closing")).toBe(true);
    expect(JSON.stringify(records)).not.toMatch(/commandLine|executablePath|AUTOPILOT_OWNER_TOKEN/);
    const capacity = (await readFile(result.report, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(capacity[0]).toMatchObject({
      buildScope: "runtime_source",
      memoryExcludesChromiumProcesses: false,
    });
    expect(
      capacity.filter((record) => record.kind === "sample").at(-1).processTree.peakRssBytes,
    ).toBeGreaterThan(0);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
}, 120000);

it("closes an owned mock browser even when closing instrumentation fails", async () => {
  const mock = await startMockAts();
  const unsubscribe = observeOwnedMockBrowsers(async (phase) => {
    if (phase === "closing") throw new Error("Synthetic measurement failure");
  });
  try {
    const owned = await launchDryRunBrowser(mock.url);
    await expect(owned.close()).rejects.toThrow("Synthetic measurement failure");
    expect(browserResources.snapshot()).toMatchObject({ browsers: 0, contexts: 0 });
  } finally {
    unsubscribe();
    await mock.app.close();
  }
}, 30000);

it("refuses private targets and paths before opening measurement/storage", async () => {
  for (const input of [
    { target: "https://private.example" },
    { dataDir: "private-sentinel" },
    { profile: "local" },
  ])
    await expect(runMonitoredCapacity(input)).rejects.toThrow();
});
