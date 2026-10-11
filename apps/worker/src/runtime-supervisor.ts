import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { errorCodeSchema } from "../../../packages/contracts/src/index.js";

const systemCodes = new Set([
  "INTERNAL",
  "EADDRINUSE",
  "EACCES",
  "EPERM",
  "ENOENT",
  "ENOMEM",
  "ERR_MODULE_NOT_FOUND",
  "SQLITE_BUSY",
  "SQLITE_ERROR",
  "SQLITE_FULL",
]);

const optionsSchema = z
  .object({
    startupMs: z.number().int().min(100).max(120000).default(30000),
    healthIntervalMs: z.number().int().min(20).max(60000).default(5000),
    shutdownMs: z.number().int().min(50).max(60000).default(30000),
    restartLimit: z.number().int().min(1).max(10).default(6),
    restartWindowMs: z.number().int().min(1000).max(3600000).default(600000),
    backoffMs: z.number().int().min(10).max(60000).default(1000),
  })
  .strict();
type Child = { process: ChildProcess; exited: Promise<void> };
export type RuntimeEvent = {
  event: "started" | "exit" | "restarting" | "stopped" | "health_failed" | "diagnostic";
  service?: "api" | "worker";
  pid?: number;
  code?: number | null;
  restart?: number;
  diagnosticCode?: string;
};

export class RuntimeSupervisor {
  private readonly controller = new AbortController();
  private readonly children: Child[] = [];
  private readonly options: z.infer<typeof optionsSchema>;
  private started = false;
  private eventFailure = false;
  private state: "starting" | "running" | "backoff" | "stopping" | "stopped" = "starting";

  constructor(
    private readonly services: {
      api: string;
      worker: string;
      cwd: string;
      env: NodeJS.ProcessEnv;
      ready(signal: AbortSignal, instance: string): Promise<boolean>;
      healthy(signal: AbortSignal, instance: string): Promise<boolean>;
      event(event: RuntimeEvent): void;
    },
    options: z.input<typeof optionsSchema> = {},
  ) {
    this.options = optionsSchema.parse(options);
  }

  status() {
    return {
      state: this.state,
      pids: this.children.flatMap((child) => (child.process.pid ? [child.process.pid] : [])),
    };
  }
  stop() {
    this.state = "stopping";
    this.controller.abort();
  }

  private emit(event: RuntimeEvent) {
    try {
      this.services.event(event);
    } catch {
      this.eventFailure = true;
      this.stop();
    }
  }

  private start(service: "api" | "worker", cycle: AbortController, instance: string) {
    const process = spawn(globalThis.process.execPath, [this.services[service]], {
      cwd: this.services.cwd,
      env: { ...this.services.env, AUTOPILOT_RUNTIME_INSTANCE: instance },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    for (const stream of [process.stdout, process.stderr]) {
      let pending = "";
      stream?.on("data", (chunk: Buffer) => {
        if (chunk.length + pending.length > 16384) {
          pending = "";
          return;
        }
        pending += chunk.toString("utf8");
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const log = JSON.parse(line);
            const code = log?.err?.code;
            if (
              typeof code === "string" &&
              (systemCodes.has(code) || errorCodeSchema.safeParse(code).success)
            )
              this.emit({ event: "diagnostic", service, diagnosticCode: code });
          } catch {
            /* Raw child output is never retained. */
          }
          newline = pending.indexOf("\n");
        }
      });
    }
    const exited = new Promise<void>((resolve) => {
      let ended = false;
      const end = (code: number | null) => {
        if (ended) return;
        ended = true;
        this.emit({ event: "exit", service, code });
        cycle.abort();
        resolve();
      };
      process.once("error", () => {
        cycle.abort();
        if (!process.pid) end(null);
      });
      process.once("exit", (code) => end(code));
    });
    this.children.push({ process, exited });
    this.emit({ event: "started", service, ...(process.pid ? { pid: process.pid } : {}) });
  }

  private async drain() {
    for (const child of this.children) {
      if (child.process.connected) {
        try {
          child.process.send({ type: "shutdown" }, () => undefined);
        } catch {
          /* The exit listener and bounded kill still own this child. */
        }
      }
    }
    const drained = Promise.all(this.children.map((child) => child.exited));
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    await Promise.race([
      drained,
      new Promise<void>((resolve) => {
        timer = globalThis.setTimeout(resolve, this.options.shutdownMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    for (const child of this.children)
      if (child.process.exitCode === null && child.process.signalCode === null)
        child.process.kill("SIGKILL");
    await drained;
    this.children.length = 0;
  }

  async run() {
    if (this.started) throw new Error("Runtime supervisor can only run once.");
    this.started = true;
    const restarts: number[] = [];
    try {
      while (!this.controller.signal.aborted) {
        const cycle = new AbortController();
        const instance = randomUUID();
        const signal = AbortSignal.any([this.controller.signal, cycle.signal]);
        try {
          this.state = "starting";
          this.start("api", cycle, instance);
          const deadline = performance.now() + this.options.startupMs;
          while (
            !signal.aborted &&
            performance.now() < deadline &&
            !(await this.services.ready(signal, instance))
          )
            await setTimeout(100, undefined, { signal });
          signal.throwIfAborted();
          if (performance.now() >= deadline) throw new Error("API readiness timed out.");
          this.start("worker", cycle, instance);
          const warmup = performance.now() + this.options.startupMs;
          while (
            !signal.aborted &&
            performance.now() < warmup &&
            !(await this.services.healthy(signal, instance))
          )
            await setTimeout(100, undefined, { signal });
          signal.throwIfAborted();
          if (performance.now() >= warmup) throw new Error("Worker readiness timed out.");
          this.state = "running";
          while (!signal.aborted) {
            await setTimeout(this.options.healthIntervalMs, undefined, { signal });
            if (!(await this.services.healthy(signal, instance))) {
              this.emit({ event: "health_failed" });
              throw new Error("Runtime health failed.");
            }
          }
        } catch {
          // All restart paths drain both children; queue recovery owns interrupted work.
        } finally {
          await this.drain();
        }
        if (this.controller.signal.aborted) break;
        const now = Date.now();
        while (restarts.length && now - (restarts[0] ?? now) >= this.options.restartWindowMs)
          restarts.shift();
        if (restarts.length >= this.options.restartLimit)
          throw new Error("Runtime restart budget exhausted.");
        restarts.push(now);
        this.state = "backoff";
        this.emit({ event: "restarting", restart: restarts.length });
        await setTimeout(
          Math.min(60000, this.options.backoffMs * 2 ** (restarts.length - 1)),
          undefined,
          { signal: this.controller.signal },
        ).catch(() => undefined);
      }
    } finally {
      this.state = "stopped";
      this.emit({ event: "stopped" });
    }
    if (this.eventFailure) throw new Error("Runtime metadata logging failed.");
  }
}
