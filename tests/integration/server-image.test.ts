import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { publicSourceFindings } from "../../packages/security/src/public-source.js";
import { createServerBuildContext } from "../../scripts/server-context.js";

const execute = promisify(execFile);
const environment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|TEMP|TMP|DOCKER_HOST|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH)$/i.test(
        key,
      ),
    ),
  );

it.skipIf(process.env.AUTOPILOT_TEST_SERVER_IMAGE !== "1")(
  "builds a non-root production image, runs network-isolated mock receipts and boots private PostgreSQL services",
  async () => {
    const context = await createServerBuildContext();
    const project = `opencareers-ci-${randomUUID()}`;
    const image = `${project}:verified`;
    const directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers-server-drill-"));
    const composePath = join(directory, "compose.json");
    const postgresEnv = join(directory, "postgres.env");
    const serverEnv = join(directory, "server.env");
    const composeEnv = join(directory, "compose.env");
    const ownerToken = randomBytes(32).toString("hex");
    const vaultKey = randomBytes(32).toString("base64");
    await writeFile(
      postgresEnv,
      "POSTGRES_USER=synthetic_server\nPOSTGRES_PASSWORD=synthetic-test-only\nPOSTGRES_DB=synthetic_server\n",
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      serverEnv,
      `AUTOPILOT_OWNER_ID=synthetic-server-owner\nAUTOPILOT_OWNER_TOKEN=${ownerToken}\nAUTOPILOT_VAULT_KEY=${vaultKey}\nAUTOPILOT_DATABASE_URL=postgresql://synthetic_server:synthetic-test-only@database:5432/synthetic_server\nAUTOPILOT_ALLOWED_ORIGINS=https://owned.synthetic.example\n`,
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(composeEnv, "", { flag: "wx", mode: 0o600 });
    const topology = JSON.parse(await readFile("deploy/server/compose.json", "utf8"));
    topology.services.api.ports = ["127.0.0.1::4317"];
    await writeFile(composePath, JSON.stringify(topology), { flag: "wx" });
    const env = {
      ...environment(),
      OPENCAREERS_SERVER_IMAGE: image,
      OPENCAREERS_POSTGRES_ENV: postgresEnv,
      OPENCAREERS_SERVER_ENV: serverEnv,
    };
    const docker = (args: string[], timeout = 60000) =>
      execute("docker", args, { env, timeout, maxBuffer: 4 * 1024 * 1024 });
    const compose = (args: string[], timeout = 60000) =>
      docker(
        [
          "compose",
          "--env-file",
          composeEnv,
          "--project-name",
          project,
          "-f",
          composePath,
          ...args,
        ],
        timeout,
      );
    let built = false;
    let started = false;
    try {
      await docker(["build", "--tag", image, context.directory], 720000);
      built = true;
      const inspected = JSON.parse((await docker(["image", "inspect", image])).stdout)[0];
      expect(inspected.Config.User).toBe("1000:1000");
      expect(inspected.Config.Env.join("\n")).not.toMatch(
        /AUTOPILOT_(OWNER_TOKEN|VAULT_KEY|DATABASE_URL|OPENROUTER_API_KEY)=/,
      );
      const history = (await docker(["history", "--no-trunc", "--format", "{{.CreatedBy}}", image]))
        .stdout;
      expect(publicSourceFindings("image-history.txt", Buffer.from(history))).toEqual([]);
      const runtimeCheck = await docker([
        "run",
        "--rm",
        "--network",
        "none",
        image,
        "node",
        "--input-type=module",
        "-e",
        "import {access} from 'node:fs/promises'; for(const p of ['.env','node_modules/typescript/package.json']) {try {await access(p);process.exit(1)}catch{}} console.log(JSON.stringify({uid:process.getuid(),node:process.versions.node}))",
      ]);
      expect(JSON.parse(runtimeCheck.stdout)).toEqual({
        uid: 1000,
        node: (await readFile(".node-version", "utf8")).trim(),
      });
      const smoke = await docker(
        [
          "run",
          "--rm",
          "--init",
          "--network",
          "none",
          "--read-only",
          "--tmpfs",
          "/tmp:size=536870912,mode=1777",
          "--shm-size",
          "256m",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges:true",
          image,
          "node",
          "dist/scripts/release-smoke.js",
        ],
        90000,
      );
      expect(JSON.parse(smoke.stdout)).toMatchObject({
        status: "passed",
        confirmedWithReceipt: 2,
        attempts: 2,
        realSubmissions: false,
        realModelCalls: false,
        productionReleaseAccepted: false,
      });
      // Only the loopback host port changes in this isolated project.
      const resolved = JSON.parse((await compose(["config", "--format", "json"])).stdout);
      expect(resolved.services.database.ports).toBeUndefined();
      expect(resolved.services.worker.ports).toBeUndefined();
      expect(
        resolved.services.api.ports.every(
          (port: { host_ip: string }) => port.host_ip === "127.0.0.1",
        ),
      ).toBe(true);
      started = true;
      try {
        await compose(["up", "--detach", "--wait", "--wait-timeout", "180"], 240000);
      } catch (error) {
        // This lane creates only disposable synthetic credentials; redact them before diagnostics.
        const logs = await compose(["logs", "--no-color", "--tail", "40", "api", "worker"]);
        console.error(
          logs.stdout.replaceAll(ownerToken, "[redacted]").replaceAll(vaultKey, "[redacted]"),
        );
        throw error;
      }
      const serviceOutput = (await compose(["ps", "--format", "json"])).stdout.trim();
      const services = serviceOutput.startsWith("[")
        ? JSON.parse(serviceOutput)
        : serviceOutput.split("\n").map((line) => JSON.parse(line));
      expect(services).toHaveLength(3);
      const api = services.find((service: { Service: string }) => service.Service === "api");
      const ports = api.Publishers.filter(
        (port: { TargetPort: number }) => port.TargetPort === 4317,
      );
      const port = ports[ports.length - 1].PublishedPort;
      expect(Number.isInteger(port) && port > 0).toBe(true);
      const endpoint = `http://127.0.0.1:${port}`;
      expect(
        (await fetch(`${endpoint}/health/ready`, { signal: AbortSignal.timeout(5000) })).status,
      ).toBe(200);
      expect(
        (await fetch(`${endpoint}/health/runtime`, { signal: AbortSignal.timeout(5000) })).status,
      ).toBe(200);
      expect(
        (await fetch(`${endpoint}/v1/operations/summary`, { signal: AbortSignal.timeout(5000) }))
          .status,
      ).toBe(401);
      const authorized = await fetch(`${endpoint}/v1/operations/summary`, {
        headers: { authorization: `Bearer ${ownerToken}` },
        signal: AbortSignal.timeout(5000),
      });
      expect(authorized.status).toBe(200);
      expect(await authorized.json()).toMatchObject({ profile: "server" });
      const dbContainer = services.find(
        (service: { Service: string }) => service.Service === "database",
      );
      const bindings = JSON.parse((await docker(["inspect", dbContainer.ID])).stdout)[0].HostConfig
        .PortBindings;
      expect(!bindings || Object.keys(bindings).length === 0).toBe(true);
    } finally {
      try {
        if (started) await compose(["down", "--volumes", "--remove-orphans"], 90000);
      } finally {
        try {
          if (built) await docker(["image", "rm", image], 30000);
        } finally {
          for (const owned of [context.directory, context.bundleDirectory, directory])
            await rm(owned, { recursive: true, force: true });
        }
      }
    }
  },
  1200000,
);
