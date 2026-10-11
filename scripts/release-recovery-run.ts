import { type ChildProcess, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createAdapterRegistry } from "../packages/browser/src/adapter-sdk.js";
import { VisibleHandoffBroker } from "../packages/browser/src/handoff-broker.js";
import { browserResources } from "../packages/browser/src/resources.js";
import { loadConfig } from "../packages/config/src/index.js";
import { startMockAts } from "../packages/mock-ats/src/server.js";
import { BrowserRepository } from "../packages/persistence/src/browser-repository.js";
import { DocumentRepository } from "../packages/persistence/src/document-repository.js";
import { HandoffRepository } from "../packages/persistence/src/handoff-repository.js";
import { connect } from "../packages/persistence/src/index.js";
import { SubmissionRepository } from "../packages/persistence/src/submission-repository.js";

export function recoveryChildEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) =>
        /^(SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|PATH|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PLAYWRIGHT_BROWSERS_PATH)$/i.test(
          key,
        ),
      ),
    ),
    AUTOPILOT_SKIP_ENV_FILE: "1",
  };
}
async function crashAcceptedWorker(child: ChildProcess) {
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error("Synthetic worker boundary timed out.")), 60000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Synthetic worker exited before its boundary.")));
      child.on("message", (message) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "boundary" in message &&
          message.boundary === "failed"
        ) {
          reject(new Error("Synthetic worker failed before acceptance."));
          return;
        }
        if (
          typeof message === "object" &&
          message !== null &&
          "boundary" in message &&
          message.boundary === "accepted_response_lost" &&
          "browserResourcesReleased" in message &&
          message.browserResourcesReleased === true
        )
          resolve();
      });
    });
  } finally {
    if (deadline) clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}

export async function runReleaseRecovery() {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers-capacity-recovery-"));
  try {
    return await runOwnedReleaseRecovery(directory);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function runOwnedReleaseRecovery(directory: string) {
  const source = import.meta.filename.endsWith(".ts");
  const child = fork(
    join(import.meta.dirname, `release-recovery-worker.${source ? "ts" : "js"}`),
    [directory],
    {
      env: recoveryChildEnvironment(),
      execArgv: source ? ["--import", "tsx"] : [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    },
  );
  await crashAcceptedWorker(child);
  const repository = await connect({ ...loadConfig({}), dataDir: directory });
  const broker = new VisibleHandoffBroker({
    visible: false,
    onOpened: async (page) => {
      const url = new URL(page.url());
      if (
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        url.pathname !== "/jobs/challenge"
      )
        throw new Error("Synthetic handoff must remain at its owned loopback fixture.");
      await page.getByRole("button", { name: "Continue" }).click();
    },
  });
  try {
    const owner = repository.ownerId;
    const before = await repository.db.query(
      "SELECT t.application_id,t.lease_until,a.state,x.dispatch_started_at,i.packet_id FROM tasks t JOIN applications a ON a.owner_id=t.owner_id AND a.id=t.application_id JOIN attempts x ON x.owner_id=t.owner_id AND x.application_id=a.id JOIN intents i ON i.owner_id=x.owner_id AND i.id=x.intent_id WHERE t.owner_id=$1 AND t.type='submit' AND t.state='leased'",
      [owner],
    );
    if (before.length !== 1 || before[0]?.state !== "IN_FLIGHT" || !before[0].dispatch_started_at)
      throw new Error("Crash did not preserve its dispatched uncertain attempt.");
    const crashed = before[0];
    const wait = Date.parse(String(crashed.lease_until)) - Date.now() + 50;
    if (!Number.isFinite(wait) || wait > 31000)
      throw new Error("Synthetic lease wait exceeds its bound.");
    if (wait > 0) await sleep(wait);
    const task = await repository.claim("release-recovery", ["reconcile"]);
    if (!task || task.applicationId !== crashed.application_id)
      throw new Error("Expired submission did not produce read-only reconciliation.");
    const documents = new DocumentRepository(repository.db, owner);
    const packet = await documents.get(String(crashed.packet_id));
    const adapter = createAdapterRegistry(directory).get("mock-ats");
    const evidence = await adapter.reconcile({
      packet,
      target: adapter.parseTarget({ fixture: "response-loss" }),
    });
    if (
      (await new SubmissionRepository(repository.db, owner).reconcileReceipt(task, evidence)) !==
      "confirmed"
    )
      throw new Error("Crash recovery did not correlate the existing mock receipt.");
    await repository.complete(task);

    const challenge = (await new BrowserRepository(repository.db, owner).snapshot()).filter(
      (item) => item.status === "challenge",
    );
    if (challenge.length !== 1 || !challenge[0]?.result.adapter)
      throw new Error("Expected one blocked synthetic challenge.");
    const prepared = challenge[0];
    const binding = prepared.result.adapter;
    if (!binding) throw new Error("Missing synthetic adapter binding.");
    const handoffs = new HandoffRepository(
      repository.db,
      owner,
      undefined,
      randomBytes(32).toString("base64"),
    );
    const created = await handoffs.create({
      applicationId: prepared.result.applicationId,
      preparationId: prepared.id,
      adapterId: binding.id,
      targetFingerprint: binding.targetFingerprint,
    });
    const session = await handoffs.claimHandoff(
      created.session.id,
      created.token,
      "release-demo:fixture",
    );
    await broker.open(session, prepared.result, "release-demo:fixture");
    const verified = await broker.verify(session.id, session.generation);
    await handoffs.completeHandoff(
      session.id,
      verified.leaseOwner,
      session.generation,
      verified.browserSession,
    );
    await broker.closeAll();
    const continuation = await handoffs.continuation(
      session.id,
      prepared.result.applicationId,
      prepared.result.packetId,
    );
    if (new URL(continuation.origin).hostname !== "127.0.0.1")
      throw new Error("Synthetic continuation left its owned fixture.");
    const challengeAttempts = await repository.db.query(
      "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2",
      [owner, prepared.result.applicationId],
    );
    if (challengeAttempts.length) throw new Error("Handoff created a final action.");
    const attempts = await repository.db.query(
      "SELECT application_id,state,COUNT(*) AS count FROM attempts WHERE owner_id=$1 GROUP BY application_id,state",
      [owner],
    );
    if (
      attempts.length !== 2 ||
      attempts.some((item) => item.state !== "CONFIRMED" || Number(item.count) !== 1)
    )
      throw new Error("Synthetic crash recovery duplicated or lost a final action.");
    const mock = await startMockAts(join(directory, "mock-ats-records"));
    try {
      const records = (await mock.app.inject({ url: "/__test/records" })).json().records;
      if (
        records.length !== 2 ||
        new Set(records.map((item: { jobId: string }) => item.jobId)).size !== 2
      )
        throw new Error("Synthetic accepted-record count is not one per dispatched job.");
    } finally {
      await mock.app.close();
    }
    const summary = await repository.summary("demo");
    const resources = browserResources.snapshot();
    if (
      summary.flow.confirmedWithReceipt !== 2 ||
      summary.flow.confirmedWithoutReceipt ||
      summary.counts.unknown ||
      resources.browsers ||
      resources.contexts ||
      resources.openingBrowsers ||
      resources.openingContexts
    )
      throw new Error("Synthetic recovery did not release resources and reconcile its receipts.");
    return {
      status: "passed" as const,
      directory,
      workerKilledAfterAcceptance: true,
      leaseRecovery: "actual_elapsed_lease" as const,
      confirmedWithReceipt: 2,
      attempts: 2,
      unresolvedOutcomes: 0,
      acceptedMockApplications: 2,
      challengeHandoff: "verified_encrypted_checkpoint" as const,
      challengeFinalActions: 0,
      browserResourcesReleased: true,
      realSubmissions: false,
      realModelCalls: false,
      matchingMethod: "reviewed_synthetic_assessment_replay",
      letterMethod: "deterministic_synthetic_fixture",
      productionReleaseAccepted: false,
      limits: [
        "Not a real CAPTCHA or employer action.",
        "Synthetic continuation key is ephemeral; the checkpoint is test-only.",
        "Not a physical reboot, server/hybrid deployment or elapsed soak.",
      ],
    };
  } finally {
    await broker.closeAll();
    await repository.db.close();
  }
}
