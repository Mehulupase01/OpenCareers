import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../../../packages/config/src/index.js";
import { ensureDemoMarker } from "../../../packages/persistence/src/index.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";

const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    pid: z.number().int().positive(),
    port: z.number().int().min(0).max(65535),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const recordPath = (config: Config) => join(config.dataDir, ".runtime", "control.json");

export async function runtimeCommand(config: Config, command: "status" | "stop") {
  const record = recordSchema.parse(JSON.parse(readFileSync(recordPath(config), "utf8")));
  if (!record.port) throw new Error("Runtime control is not yet ready.");
  const response = await fetch(`http://127.0.0.1:${record.port}/${command}`, {
    method: command === "stop" ? "POST" : "GET",
    headers: { authorization: `Bearer ${record.token}` },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Runtime control request failed.");
  const result = await response.json();
  return z
    .object({
      state: z.enum(["starting", "running", "backoff", "stopping", "stopped"]),
      pids: z.array(z.number().int().positive()).max(2),
    })
    .strict()
    .parse(result);
}

export async function runManagedRuntime(config: Config, cwd: string, env: NodeJS.ProcessEnv) {
  if (config.profile === "server")
    throw new Error("Server deployment is not installed by the local runtime launcher.");
  const root = resolve(cwd);
  const entries = {
    api: join(root, "dist/apps/api/src/main.js"),
    worker: join(root, "dist/apps/worker/src/main.js"),
  };
  if (!existsSync(entries.api) || !existsSync(entries.worker))
    throw new Error("Build the application before starting the managed runtime.");
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const physical = realpathSync(config.dataDir);
  const lexical = resolve(config.dataDir);
  if (
    process.platform === "win32"
      ? physical.toLowerCase() !== lexical.toLowerCase()
      : physical !== lexical
  )
    throw new Error("Runtime data must not be redirected by a junction or symlink.");
  if (config.profile === "demo") await ensureDemoMarker(config.dataDir);
  const directory = join(config.dataDir, ".runtime");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = recordPath(config);
  const canonical = realpathSync(config.dataDir);
  const mutexKey = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const mutexPort =
    20000 +
    (Number.parseInt(createHash("sha256").update(mutexKey).digest("hex").slice(0, 8), 16) % 40000);
  let claimed = false;
  const record: z.infer<typeof recordSchema> = {
    schemaVersion: 1,
    pid: process.pid,
    port: mutexPort,
    token: randomBytes(32).toString("hex"),
  };
  const logPath = join(directory, "events.jsonl");
  const endpoint = `http://${config.host === "::1" ? "[::1]" : config.host}:${config.port}`;
  const probe = async (route: string, signal: AbortSignal, instance: string) => {
    try {
      const response = await fetch(`${endpoint}/health/${route}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
        redirect: "error",
      });
      if (!response.ok) return false;
      const body = z
        .object({ instance: z.uuid(), status: z.literal("ready") })
        .passthrough()
        .parse(await response.json());
      return body.instance === instance;
    } catch {
      return false;
    }
  };
  const supervisor = new RuntimeSupervisor({
    ...entries,
    cwd: root,
    env: { ...env, AUTOPILOT_SKIP_ENV_FILE: "1" },
    ready: (signal, instance) => probe("ready", signal, instance),
    healthy: (signal, instance) => probe("runtime", signal, instance),
    event: (event) => {
      if (existsSync(logPath) && statSync(logPath).size >= 1048576) {
        const oldest = `${logPath}.3`;
        if (existsSync(oldest)) unlinkSync(oldest);
        for (let index = 2; index >= 1; index--) {
          const file = `${logPath}.${index}`;
          if (existsSync(file)) renameSync(file, `${logPath}.${index + 1}`);
        }
        renameSync(logPath, `${logPath}.1`);
      }
      appendFileSync(logPath, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`, {
        mode: 0o600,
      });
    },
  });
  const server = createServer((request, response) => {
    const actual = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${record.token}`);
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      response.writeHead(401).end("{}");
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      response.end(JSON.stringify(supervisor.status()));
    } else if (
      request.method === "POST" &&
      request.url === "/stop" &&
      !request.headers["transfer-encoding"] &&
      Number(request.headers["content-length"] ?? 0) === 0
    ) {
      supervisor.stop();
      response.writeHead(202).end(JSON.stringify(supervisor.status()));
    } else response.writeHead(404).end("{}");
  });
  server.maxConnections = 10;
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  const stop = () => supervisor.stop();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(mutexPort, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Runtime control failed to bind.");
    // The bound installation mutex serializes stale-record recovery and startup.
    if (existsSync(path)) {
      const previous = recordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      let alive = false;
      try {
        process.kill(previous.pid, 0);
        alive = true;
      } catch (error) {
        if (!(typeof error === "object" && error && "code" in error && error.code === "ESRCH"))
          throw error;
      }
      if (alive || Date.now() - statSync(path).mtimeMs < 5000)
        throw new Error("Another runtime may still own this installation.");
      unlinkSync(path);
    }
    writeFileSync(path, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    claimed = true;
    await supervisor.run();
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    if (
      claimed &&
      existsSync(path) &&
      recordSchema.parse(JSON.parse(readFileSync(path, "utf8"))).token === record.token
    )
      unlinkSync(path);
  }
}
