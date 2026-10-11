import { parseArgs } from "node:util";
import { runCapacity } from "./capacity-run.js";

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
try {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      duration: { type: "string" },
      interval: { type: "string" },
      sample: { type: "string" },
      cycles: { type: "string" },
    },
  });
  const result = await runCapacity(
    {
      ...(values.target !== undefined ? { target: values.target } : {}),
      ...(values.duration !== undefined ? { durationSeconds: Number(values.duration) } : {}),
      ...(values.interval !== undefined ? { intervalSeconds: Number(values.interval) } : {}),
      ...(values.sample !== undefined ? { sampleSeconds: Number(values.sample) } : {}),
      ...(values.cycles !== undefined ? { maxCycles: Number(values.cycles) } : {}),
    },
    controller.signal,
    (info) => console.log(JSON.stringify({ type: "started", ...info })),
  );
  console.log(JSON.stringify(result));
  if (result.status !== "finished") process.exitCode = 1;
} catch {
  console.error(
    "Capacity run refused or failed; only an isolated owned-mock workload is supported.",
  );
  process.exitCode = 1;
}
