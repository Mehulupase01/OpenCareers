import { expect, it } from "vitest";
import { OwnedProcessTracker, processCensusEnvironment } from "../../scripts/owned-processes.js";

it("retains Windows launcher OS prerequisites without forwarding application or provider secrets", () => {
  const input = {
    PATH: "synthetic-path",
    SYSTEMDRIVE: "C:",
    APPDATA: "synthetic-appdata",
    LOCALAPPDATA: "synthetic-local-appdata",
    PROGRAMFILES: "synthetic-program-files",
    "PROGRAMFILES(X86)": "synthetic-program-files-x86",
    AUTOPILOT_OWNER_TOKEN: "private-sentinel",
    AUTOPILOT_VAULT_KEY: "private-sentinel",
    OPENROUTER_API_KEY: "private-sentinel",
    GITHUB_TOKEN: "private-sentinel",
    PSModulePath: "unreviewed-module-search-path",
  };
  expect(processCensusEnvironment(input)).toEqual({
    PATH: input.PATH,
    SYSTEMDRIVE: input.SYSTEMDRIVE,
    APPDATA: input.APPDATA,
    LOCALAPPDATA: input.LOCALAPPDATA,
    PROGRAMFILES: input.PROGRAMFILES,
    "PROGRAMFILES(X86)": input["PROGRAMFILES(X86)"],
  });
  expect(input.AUTOPILOT_OWNER_TOKEN).toBe("private-sentinel");
});

const row = (pid: number, ppid: number, start: string, rss = 100) => ({ pid, ppid, start, rss });
it("counts only the owned tree, retains observed orphans and never adopts PID reuse", () => {
  const tracker = new OwnedProcessTracker(10);
  expect(
    tracker.sample([
      row(10, 1, "100"),
      row(20, 10, "200"),
      row(30, 20, "300"),
      row(40, 1, "400", 999999),
    ]),
  ).toMatchObject({ processCount: 3, rssBytes: 300 });
  expect(tracker.owns(40)).toBe(false);
  expect(tracker.sample([row(10, 1, "100"), row(20, 1, "200"), row(30, 20, "300")])).toMatchObject({
    processCount: 3,
    rssBytes: 300,
  });
  expect(tracker.sample([row(10, 1, "100"), row(20, 1, "201"), row(30, 1, "301")])).toMatchObject({
    processCount: 1,
    rssBytes: 100,
    peakProcesses: 3,
    peakRssBytes: 300,
  });
  expect(tracker.owns(20)).toBe(false);
});
it("refuses missing/reused roots and ambiguous or oversized census inputs", () => {
  const tracker = new OwnedProcessTracker(10);
  tracker.sample([row(10, 1, "100")]);
  expect(() => tracker.sample([])).toThrow("Owned root");
  expect(() => tracker.sample([row(10, 1, "101")])).toThrow("Owned root");
  expect(() => new OwnedProcessTracker(10).sample([row(10, 1, "100"), row(10, 1, "100")])).toThrow(
    "repeats a PID",
  );
  expect(() =>
    new OwnedProcessTracker(10).sample([
      row(10, 1, "100"),
      { ...row(20, 10, "200"), commandLine: "private sentinel" },
    ]),
  ).toThrow();
  expect(() =>
    new OwnedProcessTracker(10).sample([
      row(10, 1, "100"),
      ...Array.from({ length: 1000 }, (_, i) => row(i + 20, 10, String(i + 200))),
    ]),
  ).toThrow("tree exceeds");
});
