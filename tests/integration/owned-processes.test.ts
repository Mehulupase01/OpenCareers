import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { OwnedProcessTracker, readProcessMemory } from "../../scripts/owned-processes.js";

it("measures a real owned child and removes it after closure without reading names or command lines", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    windowsHide: true,
    stdio: "ignore",
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|HOME|USERPROFILE)$/i.test(key),
      ),
    ),
  });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  try {
    if (!child.pid) throw new Error("Missing owned child PID.");
    await sleep(100);
    const tracker = new OwnedProcessTracker();
    const sample = tracker.sample(await readProcessMemory());
    expect(tracker.owns(child.pid)).toBe(true);
    expect(sample.rssBytes).toBeGreaterThan(0);
    expect(sample.processCount).toBeGreaterThanOrEqual(2);
    expect(Object.keys(sample).sort()).toEqual(
      ["scope", "processCount", "rssBytes", "peakRssBytes", "peakProcesses"].sort(),
    );
    child.kill();
    await closed;
    tracker.sample(await readProcessMemory());
    expect(tracker.owns(child.pid)).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}, 60000);
