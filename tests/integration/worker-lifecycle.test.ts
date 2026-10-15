import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runtimeCommand } from "../../apps/worker/src/managed-runtime.js";
import { type RuntimeEvent, RuntimeSupervisor } from "../../apps/worker/src/runtime-supervisor.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { connect, ensureDemoMarker } from "../../packages/persistence/src/index.js";

const execute = promisify(execFile);
const root = process.cwd();
const fixture = resolve("tests/helpers/runtime-child.mjs");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop();
});
async function waitFor(check: () => boolean | Promise<boolean>, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Synthetic lifecycle wait timed out.");
}
const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const environment = () => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|PATH|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(
        key,
      ),
    ),
  ),
  AUTOPILOT_SKIP_ENV_FILE: "1",
});

describe("managed runtime lifecycle", () => {
  it("retains only allowlisted error codes, not arbitrary child payloads", async () => {
    const events: RuntimeEvent[] = [];
    const secret = "SYNTHETIC_UNREVIEWED_PRIVATE_VALUE";
    const supervisor = new RuntimeSupervisor(
      {
        api: fixture,
        worker: fixture,
        cwd: root,
        env: { ...environment(), SYNTHETIC_SECRET: secret },
        ready: async () => true,
        healthy: async () => true,
        event: (event) => {
          events.push(event);
        },
      },
      { shutdownMs: 2000, healthIntervalMs: 50 },
    );
    const run = supervisor.run();
    cleanup.push(async () => {
      supervisor.stop();
      await run;
    });
    await waitFor(() => events.some((event) => event.diagnosticCode === "CONFIG_INVALID"));
    supervisor.stop();
    await run;
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(
      events
        .filter((event) => event.event === "diagnostic")
        .every((event) => event.diagnosticCode === "CONFIG_INVALID"),
    ).toBe(true);
  });
  it("drains children through IPC without restarting on requested shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencareers-lifecycle-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "drained.txt");
    const events: RuntimeEvent[] = [];
    const supervisor = new RuntimeSupervisor(
      {
        api: fixture,
        worker: fixture,
        cwd: root,
        env: { ...environment(), SYNTHETIC_LIFECYCLE_FILE: file },
        ready: async () => true,
        healthy: async () => true,
        event: (event) => {
          events.push(event);
        },
      },
      { shutdownMs: 2000, healthIntervalMs: 50 },
    );
    const run = supervisor.run();
    cleanup.push(async () => {
      supervisor.stop();
      await run;
    });
    await waitFor(() => supervisor.status().state === "running");
    const pids = supervisor.status().pids;
    supervisor.stop();
    await run;
    expect(supervisor.status()).toEqual({ state: "stopped", pids: [] });
    expect((await readFile(file, "utf8")).trim().split("\n").map(Number).sort()).toEqual(
      [...pids].sort(),
    );
    expect(events.some((event) => event.event === "restarting")).toBe(false);
  });

  it("restarts after an actual worker kill with bounded backoff and no leaked children", async () => {
    const events: RuntimeEvent[] = [];
    const supervisor = new RuntimeSupervisor(
      {
        api: fixture,
        worker: fixture,
        cwd: root,
        env: environment(),
        ready: async () => true,
        healthy: async () => true,
        event: (event) => {
          events.push(event);
        },
      },
      { backoffMs: 10, shutdownMs: 2000, healthIntervalMs: 50 },
    );
    const run = supervisor.run();
    cleanup.push(async () => {
      supervisor.stop();
      await run;
    });
    await waitFor(() => supervisor.status().state === "running");
    const before = supervisor.status().pids;
    const worker = events.find(
      (event) => event.service === "worker" && event.event === "started",
    )?.pid;
    if (!worker) throw new Error("Missing synthetic worker.");
    process.kill(worker, "SIGKILL");
    await waitFor(
      () =>
        events.some((event) => event.event === "restarting") &&
        supervisor.status().state === "running",
    );
    expect(supervisor.status().pids.every((pid) => !before.includes(pid))).toBe(true);
    expect(before.every((pid) => !processAlive(pid))).toBe(true);
    supervisor.stop();
    await run;
    expect(events.filter((event) => event.event === "restarting")).toHaveLength(1);
  });

  it("bounds failed health restarts and force-stops children that ignore shutdown", async () => {
    const events: RuntimeEvent[] = [];
    let healthy = true;
    const supervisor = new RuntimeSupervisor(
      {
        api: fixture,
        worker: fixture,
        cwd: root,
        env: { ...environment(), SYNTHETIC_IGNORE_SHUTDOWN: "1" },
        ready: async () => true,
        healthy: async () => healthy,
        event: (event) => {
          events.push(event);
        },
      },
      { backoffMs: 10, shutdownMs: 50, healthIntervalMs: 20, startupMs: 100, restartLimit: 1 },
    );
    const run = supervisor.run().then(
      () => null,
      (error: unknown) => error,
    );
    cleanup.push(async () => {
      supervisor.stop();
      await run;
    });
    await waitFor(() => supervisor.status().state === "running");
    healthy = false;
    const error = await run;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("restart budget exhausted");
    expect(supervisor.status().pids).toEqual([]);
    expect(events.filter((event) => event.event === "restarting")).toHaveLength(1);
  });
});

describe("standalone compiled installation", () => {
  beforeAll(async () => {
    await execute(
      process.execPath,
      [resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
      { cwd: root, timeout: 30000 },
    );
  });
  it("outlives its detached launcher, rejects duplicate start and stops through authenticated local control", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing synthetic port.");
    const port = address.port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const env = {
      ...environment(),
      AUTOPILOT_PROFILE: "demo",
      AUTOPILOT_E2E_RUN_ID: randomUUID(),
      AUTOPILOT_PORT: String(port),
      AUTOPILOT_EXTERNAL_SUBMISSION: "false",
    };
    const config = loadConfig(env, root);
    expect(config.dataDir.startsWith(resolve(root, ".data/e2e"))).toBe(true);
    cleanup.push(() => rm(config.dataDir, { recursive: true, force: true }));
    const parent = await execute(process.execPath, [resolve("tests/helpers/runtime-parent.mjs")], {
      cwd: root,
      env,
      timeout: 5000,
    });
    const pid = Number(parent.stdout.trim());
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    cleanup.push(async () => {
      try {
        await runtimeCommand(config, "stop");
      } catch {
        if (processAlive(pid)) process.kill(pid, "SIGTERM");
      }
      await waitFor(() => !processAlive(pid), 35000);
    });
    try {
      await waitFor(async () => {
        try {
          return (await runtimeCommand(config, "status")).state === "running";
        } catch {
          return false;
        }
      }, 20000);
    } catch {
      const events = await readFile(join(config.dataDir, ".runtime/events.jsonl"), "utf8").catch(
        () => "No runtime metadata.",
      );
      throw new Error(`Synthetic startup failed: ${events}`);
    }
    expect(processAlive(pid)).toBe(true);
    expect((await runtimeCommand(config, "status")).runtimePid).toBe(pid);
    const bootstrap = await execute(
      process.execPath,
      [resolve("dist/scripts/runtime.js"), "bootstrap"],
      { cwd: root, env, timeout: 5000 },
    );
    expect(JSON.parse(bootstrap.stdout)).toMatchObject({
      profile: "demo",
      nodeVersion: process.version,
      runtimeStatus: { state: "running", runtimePid: pid },
    });
    expect((await fetch(`http://127.0.0.1:${port}/health/runtime`)).status).toBe(200);
    const record = JSON.parse(
      await readFile(join(config.dataDir, ".runtime/control.json"), "utf8"),
    ) as { port: number };
    expect((await fetch(`http://127.0.0.1:${record.port}/stop`, { method: "POST" })).status).toBe(
      401,
    );
    await expect(
      execute(process.execPath, [resolve("dist/scripts/runtime.js"), "start"], {
        cwd: root,
        env,
        timeout: 5000,
      }),
    ).rejects.toMatchObject({ code: 1 });
    expect((await runtimeCommand(config, "status")).state).toBe("running");
    const before = (await runtimeCommand(config, "status")).pids;
    const worker = before[1];
    if (!worker) throw new Error("Missing standalone scheduler.");
    process.kill(worker, "SIGKILL");
    await waitFor(async () => {
      const status = await runtimeCommand(config, "status");
      return status.state === "running" && status.pids.every((id) => !before.includes(id));
    }, 20000);
    expect(before.every((id) => !processAlive(id))).toBe(true);
    await runtimeCommand(config, "stop");
    await waitFor(() => !processAlive(pid), 35000);
    const events = await readFile(join(config.dataDir, ".runtime/events.jsonl"), "utf8");
    expect(events).toContain('"event":"stopped"');
    expect(events).not.toContain('"token"');
  }, 60000);

  it("refuses a future runtime configuration without changing it", async () => {
    const env = { ...environment(), AUTOPILOT_PROFILE: "demo", AUTOPILOT_E2E_RUN_ID: randomUUID() };
    const config = loadConfig(env, root);
    cleanup.push(() => rm(config.dataDir, { recursive: true, force: true }));
    const directory = join(config.dataDir, ".runtime");
    await mkdir(config.dataDir, { recursive: true });
    await ensureDemoMarker(config.dataDir);
    await mkdir(directory, { recursive: true });
    const future = JSON.stringify({ schemaVersion: 99, pid: 1, port: 0, token: "a".repeat(64) });
    await writeFile(join(directory, "control.json"), future);
    await expect(
      execute(process.execPath, [resolve("dist/scripts/runtime.js"), "start"], {
        cwd: root,
        env,
        timeout: 5000,
      }),
    ).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(directory, "control.json"), "utf8")).toBe(future);
  });

  it("validates an explicit private config without reading the repository env file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencareers-runtime-config-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "private.env");
    const data = join(directory, "data");
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const address = socket.address();
    if (!address || typeof address === "string") throw new Error("Missing local fixture port.");
    const port = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    await writeFile(
      file,
      `AUTOPILOT_PROFILE=local\nAUTOPILOT_PORT=${port}\nAUTOPILOT_DATA_DIR="${data.replaceAll("\\", "/")}"\nAUTOPILOT_OWNER_TOKEN=${"a".repeat(32)}\n`,
    );
    const result = await execute(
      process.execPath,
      [resolve("dist/scripts/runtime.js"), "validate", "--config", file],
      { cwd: root, env: environment(), timeout: 5000 },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      profile: "local",
      inferenceEnabled: false,
      externalSubmissionEnabled: false,
    });
    if (process.platform === "win32") {
      const args = [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        resolve("scripts/windows-runtime.ps1"),
        "-NodePath",
        process.execPath,
        "-ConfigFile",
        file,
      ];
      const runInstaller = async (extra: string[], mode = "InstallStartup") => {
        try {
          return await execute("powershell.exe", [...args, "-Mode", mode, ...extra], {
            cwd: root,
            env: environment(),
            timeout: 90000,
          });
        } catch (error) {
          const failure = error as Error & {
            code?: string | number;
            signal?: string;
            killed?: boolean;
            stdout?: string;
            stderr?: string;
          };
          throw new Error(
            `Synthetic installer failed: ${JSON.stringify({
              code: failure.code,
              signal: failure.signal,
              killed: failure.killed,
              stdout: failure.stdout,
              stderr: failure.stderr,
            })}`,
          );
        }
      };
      await expect(runInstaller([])).rejects.toThrow(
        "Startup installation requires the explicit -ApproveStartup switch.",
      );
      const preview = await runInstaller(["-ApproveStartup", "-WhatIf"]);
      expect(preview.stdout).toContain("What if:");
      const local = loadConfig({
        AUTOPILOT_PROFILE: "local",
        AUTOPILOT_DATA_DIR: data,
        AUTOPILOT_PORT: String(port),
        AUTOPILOT_OWNER_TOKEN: "a".repeat(32),
      });
      const owned: number[] = [];
      cleanup.push(async () => {
        await runtimeCommand(local, "stop").catch(() => undefined);
        await waitFor(() => owned.every((pid) => !processAlive(pid)), 35000);
      });
      const started = JSON.parse((await runInstaller([], "Start")).stdout);
      owned.push(started.runtimePid, ...started.pids);
      const evidence = await connect(local);
      try {
        const policy = await evidence.getControl();
        expect(policy.submissionsPaused).toBe(true);
        const restarted = JSON.parse((await runInstaller([], "Restart")).stdout);
        owned.push(restarted.runtimePid, ...restarted.pids);
        expect(restarted.runtimePid).not.toBe(started.runtimePid);
        expect(processAlive(started.runtimePid)).toBe(false);
        expect(await evidence.getControl()).toEqual(policy);
        expect(await evidence.db.query("SELECT id FROM attempts")).toHaveLength(0);
        await runInstaller([], "Stop");
        await waitFor(() => owned.every((pid) => !processAlive(pid)), 35000);
        expect(await readFile(file, "utf8")).not.toContain("OPENROUTER");
      } finally {
        await evidence.db.close();
      }
    }
  }, 240000);
});
