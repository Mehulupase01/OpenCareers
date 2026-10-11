import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdtemp, readdir, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { browserResources } from "../packages/browser/src/resources.js";
import { loadConfig } from "../packages/config/src/index.js";
import { connect } from "../packages/persistence/src/index.js";
import { capacityScenarios, createCapacityFixture } from "./capacity-fixture.js";

export const capacityOptions = z
  .object({
    target: z.literal("mock-ats").default("mock-ats"),
    durationSeconds: z.number().int().min(1).max(259200).default(60),
    intervalSeconds: z.number().int().min(1).max(3600).default(1800),
    sampleSeconds: z.number().int().min(1).max(60).default(60),
    maxCycles: z.number().int().min(1).max(216).default(216),
  })
  .strict();

export async function capacityDirectorySize(directory: string, maxFiles = 20000) {
  let bytes = 0;
  let files = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Synthetic capacity directory contains a link.");
    if (++files > maxFiles) throw new Error("Synthetic capacity file count exceeded its bound.");
    if (info.isDirectory()) {
      for (const entry of await readdir(current)) pending.push(join(current, entry));
    } else if (info.isFile()) bytes += info.size;
    else throw new Error("Synthetic capacity directory contains an unsupported entry.");
  }
  return { bytes, files };
}

export async function capacityBuildFingerprint(root: string) {
  const paths = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "apps",
      "packages",
      "scripts/capacity-fixture.ts",
      "scripts/capacity-run.ts",
      "scripts/capacity.ts",
      "tests/fixtures/document-packets.ts",
      "package.json",
      "pnpm-lock.yaml",
      ".node-version",
      "tsconfig.json",
      "tsconfig.build.json",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(root, path)));
  }
  return hash.digest("hex");
}

export async function runCapacity(
  raw: unknown,
  signal = new AbortController().signal,
  onStart?: (info: {
    directory: string;
    report: string;
    fingerprint: string;
    commit: string;
  }) => void,
) {
  // Validate before opening storage; no env file, credentials, target URL or private path is accepted.
  const options = capacityOptions.parse(raw);
  const root = await realpath(resolve(import.meta.dirname, ".."));
  const fingerprint = await capacityBuildFingerprint(root);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers-capacity-"));
  const config = {
    ...loadConfig({ AUTOPILOT_E2E_RUN_ID: randomUUID() }, root),
    dataDir: directory,
  };
  const repository = await connect(config);
  const report = join(directory, "capacity.jsonl");
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const deadline = started + options.durationSeconds * 1000;
  let records = 0;
  let written = 0;
  let cycles = 0;
  let stable = true;
  let nextCycle = started;
  let nextSample = started;
  let failed = false;
  let previousSample = started;
  const append = async (record: Record<string, unknown>) => {
    const line = `${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`;
    written += Buffer.byteLength(line);
    if (written > 25 * 1024 * 1024 || ++records > 9000)
      throw new Error("Capacity report exceeded its bound.");
    await appendFile(report, line, { mode: 0o600 });
  };
  const sample = async () => {
    const sampleAt = performance.now();
    const gapMs = sampleAt - previousSample;
    if (gapMs > Math.max(90000, options.sampleSeconds * 2000))
      throw new Error("Capacity sampling gap exceeded the continuity bound.");
    previousSample = sampleAt;
    if ((await capacityBuildFingerprint(root)) !== fingerprint) {
      stable = false;
      throw new Error("Runtime source changed during capacity measurement.");
    }
    const summary = await repository.summary("demo");
    const retries = Number(
      (
        await repository.db.query(
          "SELECT COALESCE(MAX(attempts),0) AS count FROM tasks WHERE owner_id=$1",
          [repository.ownerId],
        )
      )[0]?.count ?? 0,
    );
    const taskCounts = (
      await repository.db.query(
        "SELECT type,state,COUNT(*) AS count FROM tasks WHERE owner_id=$1 GROUP BY type,state ORDER BY type,state",
        [repository.ownerId],
      )
    ).map((row) => ({
      type: String(row.type),
      state: String(row.state),
      count: Number(row.count),
    }));
    const storage = await capacityDirectorySize(directory);
    const memory = process.memoryUsage();
    const browser = browserResources.snapshot();
    if (
      summary.counts.pendingTasks > 50 ||
      retries > 4 ||
      storage.bytes > 512 * 1024 * 1024 ||
      memory.rss > 1024 * 1024 * 1024
    )
      throw new Error("Synthetic capacity resource bound exceeded.");
    await append({
      kind: "sample",
      elapsedMs: performance.now() - started,
      gapMs,
      cycles,
      queue: {
        pending: summary.counts.pendingTasks,
        maximumAttempts: retries,
        tasks: taskCounts.reduce((sum, row) => sum + row.count, 0),
        byTypeAndState: taskCounts,
      },
      flow: summary.flow,
      storage,
      memory: { scope: "node_driver_process_only", ...memory },
      browser,
    });
  };
  try {
    await append({
      kind: "start",
      scope: "synthetic_capacity_harness",
      commit,
      fingerprint,
      startedAt,
      options,
      liveSubmissions: false,
      realModelCalls: false,
      letterMethod: "deterministic_synthetic_fixture",
      matchingMethod: "reviewed_synthetic_assessment_replay",
      memoryExcludesChromiumProcesses: true,
    });
    onStart?.({ directory, report, fingerprint, commit });
    const cycle = signal.aborted ? null : await createCapacityFixture(repository, directory);
    while (!signal.aborted && cycle && (cycles === 0 || performance.now() < deadline)) {
      if (performance.now() >= nextSample) {
        await sample();
        nextSample = performance.now() + options.sampleSeconds * 1000;
      }
      if (cycles < options.maxCycles && performance.now() >= nextCycle) {
        const scenario = capacityScenarios[cycles % capacityScenarios.length];
        if (!scenario) throw new Error("Synthetic workload scenario is missing.");
        const result = await cycle(scenario);
        cycles++;
        const resources = browserResources.snapshot();
        if (
          resources.browsers ||
          resources.contexts ||
          resources.openingBrowsers ||
          resources.openingContexts
        )
          throw new Error("A synthetic workload leaked browser resources.");
        await append({ kind: "cycle", ...result, cycles });
        nextCycle = performance.now() + options.intervalSeconds * 1000;
      }
      await setTimeout(Math.max(1, Math.min(1000, deadline - performance.now())), undefined, {
        signal,
      }).catch(() => undefined);
    }
    await sample();
  } catch (error) {
    failed = true;
    await append({
      kind: "failure",
      reason: error instanceof Error ? error.message : "Synthetic capacity run failed.",
    });
  } finally {
    await repository.db.close();
  }
  const elapsedMs = performance.now() - started;
  const result = {
    directory,
    report,
    cycles,
    elapsedMs,
    requestedSeconds: options.durationSeconds,
    status: failed ? "failed" : signal.aborted ? "interrupted" : "finished",
    stable,
    durationSatisfied: !failed && !signal.aborted && elapsedMs >= options.durationSeconds * 1000,
    productionSoakGateSatisfied: false,
  };
  await append({ kind: "finish", ...result });
  return result;
}
