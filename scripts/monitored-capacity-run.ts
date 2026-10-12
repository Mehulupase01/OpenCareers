import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { observeOwnedMockBrowsers } from "../packages/browser/src/runtime.js";
import { capacityOptions, runCapacity } from "./capacity-run.js";
import { OwnedProcessTracker, readProcessMemory } from "./owned-processes.js";

export async function runMonitoredCapacity(raw: unknown, signal = new AbortController().signal) {
  const options = capacityOptions.parse(raw);
  const tracker = new OwnedProcessTracker();
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let report = "";
  let records = 0,
    bytes = 0;
  let previous = performance.now();
  let failure: Error | undefined;
  let queue = Promise.resolve();
  const started = performance.now();
  const wallStarted = Date.now();
  const capture = (phase: string) => {
    const task = queue.then(async () => {
      if (failure) throw failure;
      const now = performance.now();
      if (now - previous > 30000 || Math.abs(Date.now() - wallStarted - (now - started)) > 30000)
        throw new Error("Process measurement lost clock/sampling continuity.");
      const sample = tracker.sample(await readProcessMemory());
      previous = performance.now();
      if (sample.peakRssBytes > 2 * 1024 ** 3 || sample.peakProcesses > 128)
        throw new Error("Owned process resource bound exceeded.");
      if (report) {
        const line = `${JSON.stringify({ kind: "process_sample", time: new Date().toISOString(), elapsedMs: performance.now() - started, phase, ...sample })}\n`;
        bytes += Buffer.byteLength(line);
        if (++records > 72000 || bytes > 25 * 1024 ** 2)
          throw new Error("Process measurement report exceeded its bound.");
        await appendFile(report, line, { mode: 0o600 });
      }
      return sample;
    });
    queue = task.then(
      () => {},
      (error) => {
        failure = error instanceof Error ? error : new Error("Process measurement failed.");
        controller.abort();
      },
    );
    return task;
  };
  const baseline = await capture("initial");
  const unsubscribe = observeOwnedMockBrowsers((phase) => capture(phase).then(() => {}));
  const monitoring = (async () => {
    while (!combined.aborted) {
      await sleep(5000, undefined, { signal: combined }).catch(() => {});
      if (combined.aborted) break;
      try {
        await capture("periodic");
      } catch {
        break;
      }
    }
  })();
  try {
    const result = await runCapacity(
      options,
      combined,
      async (info) => {
        report = join(info.directory, "process-memory.jsonl");
        await writeFile(
          report,
          `${JSON.stringify({ kind: "start", time: new Date().toISOString(), fingerprint: info.fingerprint, commit: info.commit, scope: "observed_owned_tree_rss_sum", intervalSeconds: 5, samplesAtBrowserOpenAndClose: true, excludesSystemAndGpuMemory: true, productionSoakGateSatisfied: false })}\n`,
          { flag: "wx", mode: 0o600 },
        );
        await capture("ready");
      },
      () => capture("capacity_sample"),
    );
    let final = failure ? null : await capture("finished");
    for (
      let attempt = 0;
      final && final.processCount > baseline.processCount && attempt < 10;
      attempt++
    ) {
      await sleep(500);
      final = await capture("draining");
    }
    if (final && final.processCount > baseline.processCount) {
      failure = new Error("Observed owned processes did not return to their initial census bound.");
    }
    const status = failure ? "failed" : result.status;
    if (report)
      await appendFile(
        report,
        `${JSON.stringify({ kind: "finish", time: new Date().toISOString(), elapsedMs: performance.now() - started, status, samples: records, baselineObservedProcesses: baseline.processCount, processTree: final, resourceCollectionFailed: Boolean(failure), productionSoakGateSatisfied: false })}\n`,
        { mode: 0o600 },
      );
    return {
      ...result,
      status,
      processMemoryReport: report,
      processSamples: records,
      processTree: final,
      resourceCollectionFailed: Boolean(failure),
      productionSoakGateSatisfied: false,
    };
  } finally {
    unsubscribe();
    controller.abort();
    await monitoring;
    await queue;
  }
}
