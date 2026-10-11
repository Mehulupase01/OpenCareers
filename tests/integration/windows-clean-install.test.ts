import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import yauzl from "yauzl";
import { runtimeCommand } from "../../apps/worker/src/managed-runtime.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { buildWindowsBundle } from "../../scripts/windows-bundle.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

const execute = promisify(execFile);
const environment = () => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|PATH|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(
        key,
      ),
    ),
  ),
  AUTOPILOT_SKIP_ENV_FILE: "1",
  CI: "1",
});

it.skipIf(process.env.AUTOPILOT_TEST_CLEAN_INSTALL !== "1")(
  "installs the checked bundle's production dependencies and boots its compiled synthetic runtime",
  async () => {
    const bundle = await buildWindowsBundle();
    const installation = join(bundle.directory, "clean installation");
    const archiveBytes = await readFile(bundle.path);
    expect(createHash("sha256").update(archiveBytes).digest("hex")).toBe(bundle.checksum);
    const archive = await yauzl.fromBufferPromise(archiveBytes, {
      lazyEntries: true,
      strictFileNames: true,
    });
    try {
      for await (const entry of archive.eachEntry()) {
        if (entry.fileName.includes("..") || entry.fileName.startsWith("/"))
          throw new Error("Unsafe fixture entry.");
        const path = join(installation, entry.fileName);
        await mkdir(dirname(path), { recursive: true });
        const chunks: Buffer[] = [];
        for await (const chunk of await archive.openReadStreamPromise(entry))
          chunks.push(Buffer.from(chunk));
        await writeFile(path, Buffer.concat(chunks), { flag: "wx" });
      }
    } finally {
      archive.close();
    }
    const verified = await execute(process.execPath, ["dist/scripts/verify-bundle.js"], {
      cwd: installation,
      env: environment(),
      timeout: 30000,
    });
    expect(JSON.parse(verified.stdout)).toMatchObject({
      status: "integrity_verified",
      dependenciesVerified: false,
      publisherIdentityVerified: false,
      productionReleaseAccepted: false,
    });
    const installedManifestSha256 = createHash("sha256")
      .update(await readFile(join(installation, "bundle-manifest.json")))
      .digest("hex");
    const verifiedExpected = await execute(
      process.execPath,
      ["dist/scripts/verify-bundle.js", "--manifest-sha256", installedManifestSha256],
      {
        cwd: installation,
        env: environment(),
        timeout: 30000,
      },
    );
    expect(JSON.parse(verifiedExpected.stdout).expectedManifestMatched).toBe(true);
    const workerArtifact = join(installation, "dist/apps/worker/src/main.js");
    const originalWorker = await readFile(workerArtifact);
    const changedWorker = Buffer.from(originalWorker);
    changedWorker[0] = changedWorker[0] === 120 ? 121 : 120;
    await writeFile(workerArtifact, changedWorker);
    try {
      await expect(
        execute(process.execPath, ["dist/scripts/verify-bundle.js"], {
          cwd: installation,
          env: environment(),
          timeout: 30000,
        }),
      ).rejects.toMatchObject({
        stdout: "",
        stderr: expect.stringContaining("Bundle verification failed"),
      });
    } finally {
      await writeFile(workerArtifact, originalWorker);
    }
    await expect(
      execute(
        process.execPath,
        ["dist/scripts/verify-bundle.js", "--manifest-sha256", "0".repeat(64)],
        {
          cwd: installation,
          env: environment(),
          timeout: 30000,
        },
      ),
    ).rejects.toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("Bundle verification failed"),
    });
    await execute(
      process.platform === "win32" ? "powershell.exe" : "corepack",
      process.platform === "win32"
        ? [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "& corepack pnpm install --prod --frozen-lockfile; exit $LASTEXITCODE",
          ]
        : ["pnpm", "install", "--prod", "--frozen-lockfile"],
      { cwd: installation, env: environment(), timeout: 180000, maxBuffer: 1024 * 1024 },
    );
    await writeFile(
      join(installation, "synthetic-document-input.json"),
      JSON.stringify(documentGenerationInput()),
    );
    const imported = await execute(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'const {readFile}=await import("node:fs/promises"); const {ArtifactStore}=await import("./dist/packages/documents/src/artifact-store.js"); const {buildPacket}=await import("./dist/packages/documents/src/factory.js"); const store=new ArtifactStore("../synthetic-packets"); await store.initialize(); const input=JSON.parse(await readFile("synthetic-document-input.json","utf8")); const packet=await buildPacket(store, {...input, requestedAnswers:[]}); const uncertain=await buildPacket(store,input); console.log(JSON.stringify({validation:packet.manifest.validation, unknownAnswerStatus:uncertain.manifest.validation.status, kinds:packet.manifest.artifacts.map(a=>a.kind)}));',
      ],
      { cwd: installation, env: environment(), timeout: 15000 },
    );
    const packet = JSON.parse(imported.stdout.trim());
    expect(packet.validation.status).toBe("valid");
    expect(packet.unknownAnswerStatus).toBe("needs_input");
    await expect(
      readFile(join(installation, "node_modules/typescript/package.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(packet.kinds).toEqual(
      expect.arrayContaining(["cv_pdf", "cv_docx", "letter_pdf", "letter_docx"]),
    );
    const smoke = await execute(process.execPath, ["dist/scripts/release-smoke.js"], {
      cwd: installation,
      env: {
        ...environment(),
        AUTOPILOT_PROFILE: "local",
        AUTOPILOT_DATA_DIR: "must-not-open-this-existing-private-path",
        AUTOPILOT_DATABASE_URL: "must-not-connect-to-this-private-database",
        AUTOPILOT_EXTERNAL_SUBMISSION: "true",
      },
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    const workflow = JSON.parse(smoke.stdout.trim());
    expect(workflow).toMatchObject({
      status: "passed",
      confirmedWithReceipt: 2,
      attempts: 2,
      unresolvedOutcomes: 0,
      browserResourcesReleased: true,
      realSubmissions: false,
      realModelCalls: false,
      productionReleaseAccepted: false,
      scenarios: [
        { scenario: "standard", outcome: "confirmed" },
        { scenario: "response-loss", outcome: "reconciled_confirmed" },
        { scenario: "changed-question", outcome: "needs_input" },
      ],
    });
    await expect(
      execute(process.execPath, ["dist/scripts/release-smoke.js", "--target", "external"], {
        cwd: installation,
        env: environment(),
        timeout: 10000,
      }),
    ).rejects.toMatchObject({ code: 1 });
    const recovered = await execute(process.execPath, ["dist/scripts/release-recovery.js"], {
      cwd: installation,
      env: {
        ...environment(),
        AUTOPILOT_PROFILE: "local",
        AUTOPILOT_DATA_DIR: "must-not-open-this-existing-private-path",
        AUTOPILOT_DATABASE_URL: "must-not-connect-to-this-private-database",
        AUTOPILOT_EXTERNAL_SUBMISSION: "true",
      },
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      status: "passed",
      workerKilledAfterAcceptance: true,
      leaseRecovery: "actual_elapsed_lease",
      confirmedWithReceipt: 2,
      attempts: 2,
      acceptedMockApplications: 2,
      challengeHandoff: "verified_encrypted_checkpoint",
      challengeFinalActions: 0,
      realSubmissions: false,
      realModelCalls: false,
      productionReleaseAccepted: false,
    });
    await expect(
      execute(process.execPath, ["dist/scripts/release-recovery.js", "--target", "external"], {
        cwd: installation,
        env: environment(),
        timeout: 10000,
      }),
    ).rejects.toMatchObject({ code: 1 });
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const address = socket.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port.");
    const port = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const env = {
      ...environment(),
      AUTOPILOT_PROFILE: "demo",
      AUTOPILOT_E2E_RUN_ID: randomUUID(),
      AUTOPILOT_PORT: String(port),
      AUTOPILOT_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    };
    const config = loadConfig(env, installation);
    const child = spawn(process.execPath, ["dist/scripts/runtime.js", "start"], {
      cwd: installation,
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    let exited = false;
    let exitCode: number | null = null;
    let startError: Error | undefined;
    const ownedChildren: number[] = [];
    child.once("exit", (code) => {
      exited = true;
      exitCode = code;
    });
    const ended = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", (error) => {
        startError = error;
        exited = true;
        resolve();
      });
    });
    try {
      const deadline = Date.now() + 30000;
      let ready = false;
      while (Date.now() < deadline && !exited) {
        try {
          const status = await runtimeCommand(config, "status");
          ready = status.state === "running";
          if (ready) {
            ownedChildren.push(...status.pids);
            break;
          }
        } catch {
          /* The fresh runtime has not yet published its authenticated control. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(ready).toBe(true);
      const health = await fetch(`http://127.0.0.1:${port}/health/ready`, {
        signal: AbortSignal.timeout(5000),
      });
      expect(health.ok).toBe(true);
      const web = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
      expect(web.ok).toBe(true);
      expect(await web.text()).toContain('<div id="root">');
    } finally {
      if (!exited) {
        await runtimeCommand(config, "stop").catch(() => child.kill());
        await Promise.race([
          ended,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Clean runtime drain timed out.")), 15000).unref(),
          ),
        ]);
      }
    }
    expect(startError).toBeUndefined();
    expect(exitCode).toBe(0);
    expect(ownedChildren).toHaveLength(2);
    for (const pid of ownedChildren) {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    }
    // Keep the synthetic install and immutable archive for inspection; no private data was used.
    const evidence = join(process.cwd(), "test-results/windows-runtime");
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "runtime.zip"), archiveBytes);
    await writeFile(join(evidence, "runtime.zip.sha256"), `${bundle.checksum}  runtime.zip\n`);
    await writeFile(
      join(evidence, "clean-install.json"),
      JSON.stringify(
        {
          status: "passed",
          platform: process.platform,
          nodeVersion: process.version,
          productionOnlyDependencies: true,
          syntheticPacketValidation: packet.validation.status,
          unknownAnswerStatus: packet.unknownAnswerStatus,
          compiledRuntimeReady: true,
          compiledDashboardServed: true,
          guardedMockWorkflow: workflow,
          gracefullyStopped: true,
          realSubmissions: false,
          installedLogonTaskVerified: false,
          productionReleaseAccepted: false,
          archiveSha256: bundle.checksum,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        cleanInstallDirectory: installation,
        archiveSha256: bundle.checksum,
        realSubmissions: false,
      }),
    );
  },
  240000,
);
