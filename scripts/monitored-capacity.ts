import { parseArgs } from "node:util";
import { runMonitoredCapacity } from "./monitored-capacity-run.js";

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
try {
  const { values } = parseArgs({
    options: {
      duration: { type: "string" },
      interval: { type: "string" },
      sample: { type: "string" },
      cycles: { type: "string" },
    },
  });
  const result = await runMonitoredCapacity(
    {
      ...(values.duration !== undefined ? { durationSeconds: Number(values.duration) } : {}),
      ...(values.interval !== undefined ? { intervalSeconds: Number(values.interval) } : {}),
      ...(values.sample !== undefined ? { sampleSeconds: Number(values.sample) } : {}),
      ...(values.cycles !== undefined ? { maxCycles: Number(values.cycles) } : {}),
    },
    controller.signal,
  );
  console.log(JSON.stringify(result));
  if (result.status !== "finished") process.exitCode = 1;
} catch {
  console.error(
    "Monitored capacity failed; only fresh synthetic mock storage and supported OS measurements are allowed.",
  );
  process.exitCode = 1;
}
