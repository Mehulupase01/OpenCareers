import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const environment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|PATH|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(
        key,
      ),
    ),
  );

// A disposable runtime exercises the real host and launcher, without application services.
const runtime = String.raw`
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const command = process.argv[2];
const settings = () => JSON.parse(fs.readFileSync("settings.json", "utf8"));
const event = (kind, extra = {}) => fs.appendFileSync("events.jsonl", JSON.stringify({kind, pid: process.pid, ...extra}) + "\n");
const recordPath = "control.json";
async function main() {
  if (command === "validate") {
    console.log(JSON.stringify({profile: "local"}));
    return;
  }
  if (command === "status" || command === "stop") {
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    const response = await fetch("http://127.0.0.1:" + record.port + "/" + command, {
      method: command === "stop" ? "POST" : "GET",
      headers: {authorization: "Bearer " + record.token},
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw Error("Unauthenticated control");
    console.log(JSON.stringify(await response.json()));
    return;
  }
  event("launch", {args: process.argv.slice(2), cwd: process.cwd(), keys: Object.keys(process.env), skip: process.env.AUTOPILOT_SKIP_ENV_FILE});
  if (fs.existsSync(recordPath) || settings().failStart) process.exit(19);
  const token = crypto.randomBytes(32).toString("hex");
  let state = "starting";
  let stopping = false;
  const status = () => ({state: settings().state || state, pids: [], ...(settings().missingPid ? {} : {runtimePid: process.pid})});
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== "Bearer " + token) return response.writeHead(401).end("{}");
    if (request.url === "/stop" && request.method === "POST") {
      event("stop");
      state = "stopping";
      if (!settings().hangShutdown) {
        stopping = true;
        setTimeout(finish, settings().shutdownMs || 100);
      }
    }
    response.end(JSON.stringify(status()));
  });
  function finish() {
    if (fs.existsSync(recordPath) && JSON.parse(fs.readFileSync(recordPath, "utf8")).token === token) fs.unlinkSync(recordPath);
    event("exit");
    process.exit(0);
  }
  server.listen(0, "127.0.0.1", () => {
    fs.writeFileSync(recordPath, JSON.stringify({pid: process.pid, port: server.address().port, token}), {flag: "wx"});
    setTimeout(() => {
      if (!settings().neverReady && !stopping) { state = "running"; event("ready"); }
    }, settings().readyMs || 100);
  });
  setInterval(() => { if (fs.existsSync("release")) finish(); }, 50);
  setTimeout(finish, 60000);
}
main().catch(() => process.exitCode = 1);
`;

type Event = {
  kind: string;
  pid: number;
  args?: string[];
  keys?: string[];
  cwd?: string;
  skip?: string;
};
type Settings = Record<string, string | number | boolean>;
const fixtures: string[] = [];
async function events(directory: string): Promise<Event[]> {
  const text = await readFile(join(directory, "events.jsonl"), "utf8").catch(() => "");
  return text.trim()
    ? text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}
async function waitFor(check: () => Promise<boolean>, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Synthetic launcher wait timed out");
}
async function fixture(settings: Settings = {}) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers launcher fixture "));
  fixtures.push(directory);
  await mkdir(join(directory, "dist/scripts"), { recursive: true });
  await mkdir(join(directory, "scripts"));
  await copyFile(
    resolve("scripts/windows-startup-host.ps1"),
    join(directory, "scripts/windows-startup-host.ps1"),
  );
  await writeFile(join(directory, "dist/scripts/runtime.js"), runtime);
  const config = join(directory, "explicit private fixture.env");
  await writeFile(config, "SYNTHETIC_CONFIGURATION_ONLY=1\n");
  const configure = (value: Settings) =>
    writeFile(join(directory, "settings.json"), JSON.stringify(value));
  await configure(settings);
  const run = (mode: string, extra: string[] = []) =>
    execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        resolve("scripts/windows-runtime.ps1"),
        "-Mode",
        mode,
        "-InstallRoot",
        directory,
        "-ConfigFile",
        config,
        "-NodePath",
        process.execPath,
        "-TimeoutSeconds",
        "5",
        ...extra,
      ],
      {
        cwd: directory,
        env: {
          ...environment(),
          NODE_OPTIONS: "--require=missing-synthetic-preload.cjs",
          AUTOPILOT_OWNER_TOKEN: "synthetic-not-a-token",
        },
        timeout: 25000,
        windowsHide: true,
      },
    );
  return { directory, config, configure, run, events: () => events(directory) };
}

describe.skipIf(process.platform !== "win32")(
  "isolated Windows launcher readiness and restart",
  () => {
    afterEach(async () => {
      for (const directory of fixtures.splice(0)) {
        await writeFile(join(directory, "release"), "fixture cleanup");
        await waitFor(async () => {
          const observed = await events(directory);
          return observed
            .filter((entry) => entry.kind === "launch")
            .every((entry) => {
              try {
                process.kill(entry.pid, 0);
                return false;
              } catch {
                return true;
              }
            });
        });
        await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      }
    });

    it("waits for running with explicit spaced paths and isolated env; Start is idempotent and refuses a busy owner", async () => {
      const f = await fixture({ readyMs: 1800 });
      const result = JSON.parse((await f.run("Start")).stdout);
      expect(result.state).toBe("running");
      const observed = await f.events();
      const launch = observed.find((entry) => entry.kind === "launch");
      expect(launch).toMatchObject({
        args: ["start", "--config", f.config],
        cwd: f.directory,
        skip: "1",
      });
      expect(launch?.keys).not.toContain("NODE_OPTIONS");
      expect(launch?.keys).not.toContain("AUTOPILOT_OWNER_TOKEN");
      expect(observed.some((entry) => entry.kind === "ready")).toBe(true);
      expect(result.runtimePid).toBe(launch?.pid);
      expect(JSON.parse((await f.run("Start")).stdout).runtimePid).toBe(result.runtimePid);
      await f.configure({ state: "backoff" });
      await expect(f.run("Start")).rejects.toMatchObject({ code: 1 });
      expect((await f.events()).filter((entry) => entry.kind === "launch")).toHaveLength(1);
    }, 60000);

    it("restarts only after authenticated supervisor exit and preserves owner policy", async () => {
      const f = await fixture({ shutdownMs: 1800 });
      const policy = join(f.directory, "owner-policy.json");
      const policyText = '{"paused":true,"submissionAuthorized":false}';
      await writeFile(policy, policyText);
      const first = JSON.parse((await f.run("Start")).stdout);
      const replacement = JSON.parse((await f.run("Restart")).stdout);
      expect(replacement.state).toBe("running");
      expect(replacement.runtimePid).not.toBe(first.runtimePid);
      const lifecycle = (await f.events()).filter((entry) =>
        ["launch", "stop", "exit"].includes(entry.kind),
      );
      expect(lifecycle.map((entry) => entry.kind)).toEqual(["launch", "stop", "exit", "launch"]);
      expect(lifecycle.slice(0, 3).every((entry) => entry.pid === first.runtimePid)).toBe(true);
      expect(await readFile(policy, "utf8")).toBe(policyText);
    }, 60000);

    it("reports failed startup and bounded readiness timeout without removing ownership or killing the runtime", async () => {
      const failed = await fixture({ failStart: true });
      await expect(failed.run("Start")).rejects.toMatchObject({ code: 1 });
      expect((await failed.events()).filter((entry) => entry.kind === "launch")).toHaveLength(1);
      const hung = await fixture({ neverReady: true });
      await expect(hung.run("Start")).rejects.toMatchObject({ code: 1 });
      const record = await readFile(join(hung.directory, "control.json"), "utf8");
      const pid = JSON.parse(record).pid;
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect((await hung.events()).some((entry) => entry.kind === "exit")).toBe(false);
      await expect(hung.run("Start")).rejects.toMatchObject({ code: 1 });
      expect(await readFile(join(hung.directory, "control.json"), "utf8")).toBe(record);
      expect((await hung.events()).filter((entry) => entry.kind === "launch")).toHaveLength(1);
    }, 60000);

    it("refuses unknown identity, nonrunning authentication and hung shutdown without replacement or record deletion", async () => {
      const f = await fixture();
      await f.run("Start");
      const path = join(f.directory, "control.json");
      const record = await readFile(path, "utf8");
      await f.configure({ missingPid: true });
      await expect(f.run("Restart")).rejects.toMatchObject({ code: 1 });
      expect((await f.events()).some((entry) => entry.kind === "stop")).toBe(false);
      await f.configure({ hangShutdown: true });
      await expect(f.run("Restart")).rejects.toMatchObject({ code: 1 });
      expect(() => process.kill(JSON.parse(record).pid, 0)).not.toThrow();
      expect(await readFile(path, "utf8")).toBe(record);
      expect((await f.events()).filter((entry) => entry.kind === "launch")).toHaveLength(1);
      const stale = await fixture();
      const staleRecord = '{"pid":1,"port":0,"token":"unknown-owner"}';
      await writeFile(join(stale.directory, "control.json"), staleRecord);
      await expect(stale.run("Restart")).rejects.toMatchObject({ code: 1 });
      expect(await stale.events()).toEqual([]);
      expect(await readFile(join(stale.directory, "control.json"), "utf8")).toBe(staleRecord);
      const stopCount = (await f.events()).filter((entry) => entry.kind === "stop").length;
      await f.configure({ state: "stopping", hangShutdown: true });
      await expect(f.run("Restart")).rejects.toMatchObject({ code: 1 });
      expect((await f.events()).filter((entry) => entry.kind === "stop")).toHaveLength(stopCount);
    }, 60000);

    it("WhatIf performs no lifecycle actions for Start or Restart", async () => {
      const f = await fixture();
      expect((await f.run("Start", ["-WhatIf"])).stdout).toContain("What if:");
      expect(await f.events()).toEqual([]);
      await f.run("Start");
      const before = await f.events();
      const record = await readFile(join(f.directory, "control.json"), "utf8");
      expect((await f.run("Restart", ["-WhatIf"])).stdout).toContain("What if:");
      expect(await f.events()).toEqual(before);
      expect(await readFile(join(f.directory, "control.json"), "utf8")).toBe(record);
    }, 60000);
  },
);
