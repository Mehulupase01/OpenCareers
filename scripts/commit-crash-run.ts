import { fork } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdapterRegistry } from "../packages/browser/src/adapter-sdk.js";
import { browserResources } from "../packages/browser/src/resources.js";
import { loadConfig } from "../packages/config/src/index.js";
import { startMockAts } from "../packages/mock-ats/src/server.js";
import { DocumentRepository } from "../packages/persistence/src/document-repository.js";
import { connect } from "../packages/persistence/src/index.js";
import { Repository } from "../packages/persistence/src/repository.js";
import { SubmissionRepository } from "../packages/persistence/src/submission-repository.js";
import { type CommitCrashBoundary, commitCrashBoundaries } from "./capacity-fixture.js";
import { recoveryChildEnvironment } from "./release-recovery-run.js";

async function killAtBoundary(directory: string, boundary: CommitCrashBoundary) {
  const source = import.meta.filename.endsWith(".ts");
  const child = fork(
    join(import.meta.dirname, `commit-crash-worker.${source ? "ts" : "js"}`),
    [directory, boundary],
    {
      env: recoveryChildEnvironment(),
      execArgv: source ? ["--import", "tsx"] : [],
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  let reached = false,
    failed = false;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      failed = true;
      child.kill("SIGKILL");
    }, 45000);
    child.once("error", () => {
      failed = true;
      child.kill("SIGKILL");
    });
    child.on("message", (message) => {
      if (
        reached ||
        typeof message !== "object" ||
        message === null ||
        !("boundary" in message) ||
        message.boundary !== boundary ||
        !("browserResourcesReleased" in message) ||
        message.browserResourcesReleased !== true ||
        !("writeTransactionOpen" in message) ||
        message.writeTransactionOpen !==
          ["intent_transaction_open", "receipt_transaction_open"].includes(boundary) ||
        (["intent_transaction_open", "receipt_transaction_open"].includes(boundary) &&
          (!("staged" in message) ||
            typeof message.staged !== "object" ||
            message.staged === null ||
            !("attempts" in message.staged) ||
            message.staged.attempts !== 1 ||
            !("receipts" in message.staged) ||
            message.staged.receipts !== (boundary === "receipt_transaction_open" ? 1 : 0)))
      )
        failed = true;
      else reached = true;
      child.kill("SIGKILL");
    });
    child.once("close", (_code, signal) => {
      clearTimeout(timer);
      if (!reached || failed || signal !== "SIGKILL")
        reject(new Error("Synthetic worker did not reach its declared crash boundary"));
      else resolve();
    });
  });
}

async function recoverCase(directory: string, boundary: CommitCrashBoundary) {
  await killAtBoundary(directory, boundary);
  const connected = await connect({ ...loadConfig({}), dataDir: directory });
  try {
    const db = connected.db,
      owner = connected.ownerId;
    if (
      (await db.query("PRAGMA quick_check"))[0]?.quick_check !== "ok" ||
      (await db.query("PRAGMA foreign_key_check")).length
    )
      throw new Error("The interrupted database failed consistency checks");
    const task = (
      await db.query("SELECT * FROM tasks WHERE owner_id=$1 AND type='submit' AND state='leased'", [
        owner,
      ])
    )[0];
    const app = (await db.query("SELECT id,state FROM applications WHERE owner_id=$1", [owner]))[0];
    if (!task || !app) throw new Error("Crash did not preserve its leased synthetic workflow");
    const instant = Date.parse(String(task.lease_until)) + 1;
    if (!Number.isFinite(instant) || instant > Date.now() + 31000)
      throw new Error("Invalid synthetic lease boundary");
    const clock = () => new Date(Math.max(Date.now(), instant));
    const repository = new Repository(db, owner, clock);
    // Failure injection is removed only in this owned synthetic database after the kill.
    if (boundary === "receipt_write_failed")
      await db.query("DROP TRIGGER synthetic_receipt_failure");
    const receiptBefore = Number(
      (await db.query("SELECT COUNT(*) AS n FROM receipts WHERE owner_id=$1", [owner]))[0]?.n,
    );
    const attemptsBefore = Number(
      (await db.query("SELECT COUNT(*) AS n FROM attempts WHERE owner_id=$1", [owner]))[0]?.n,
    );
    const intentsBefore = Number(
      (await db.query("SELECT COUNT(*) AS n FROM intents WHERE owner_id=$1", [owner]))[0]?.n,
    );
    if (
      boundary === "receipt_transaction_open" &&
      (app.state !== "IN_FLIGHT" || receiptBefore !== 0)
    )
      throw new Error("Uncommitted receipt state escaped its rolled-back transaction");
    const retry = await repository.claim("crash-replacement", ["submit"]);
    let outcome: string;
    if (["claimed_before_intent", "intent_transaction_open"].includes(boundary)) {
      if (
        !retry ||
        retry.applicationId !== app.id ||
        retry.fence <= Number(task.fence) ||
        attemptsBefore !== 0 ||
        intentsBefore !== 0 ||
        app.state !== "READY" ||
        receiptBefore !== 0
      )
        throw new Error("Pre-intent crash did not preserve retryable work");
      outcome = "retryable_before_intent";
    } else {
      if (retry) throw new Error("A recorded final-action intent was replayed");
      if (intentsBefore !== 1 || attemptsBefore !== 1)
        throw new Error("Durable intent and attempt lost their atomic binding");
      if (boundary === "receipt_before_task_complete") {
        if (receiptBefore !== 1 || app.state !== "CONFIRMED")
          throw new Error("Committed receipt was lost");
        outcome = "already_confirmed";
      } else {
        if (receiptBefore !== 0) throw new Error("Receipt failure did not roll back atomically");
        const reconcile = await repository.claim("crash-reconciler", ["reconcile"]);
        if (!reconcile || reconcile.applicationId !== app.id)
          throw new Error("Missing read-only reconciliation task");
        const intent = (
          await db.query("SELECT packet_id FROM intents WHERE owner_id=$1 AND application_id=$2", [
            owner,
            String(app.id),
          ])
        )[0];
        if (!intent) throw new Error("Missing durable packet binding");
        const packet = await new DocumentRepository(db, owner).get(String(intent.packet_id));
        const adapter = createAdapterRegistry(directory).get("mock-ats");
        const evidence = await adapter.reconcile({
          packet,
          target: adapter.parseTarget({ fixture: "standard" }),
        });
        outcome = await new SubmissionRepository(db, owner, clock).reconcileReceipt(
          reconcile,
          evidence,
        );
        await repository.complete(reconcile);
        const accepted = [
          "accepted_before_receipt",
          "receipt_write_failed",
          "receipt_transaction_open",
        ].includes(boundary);
        if (outcome !== (accepted ? "confirmed" : "needs_review"))
          throw new Error("Missing receipts were invented or accepted records were lost");
      }
      // Redelivery cannot create a second final action, even under distinct queue keys.
      for (let index = 0; index < 3; index++)
        await repository.enqueue({
          type: "submit",
          applicationId: String(app.id),
          domain: "mock-ats",
          dedupeKey: `synthetic-redelivery:${index}`,
        });
      if (
        (await repository.claim("duplicate-worker-a", ["submit"])) ||
        (await repository.claim("duplicate-worker-b", ["submit"]))
      )
        throw new Error("Redelivery bypassed final-action fencing");
      if (
        Number(
          (await db.query("SELECT COUNT(*) AS n FROM attempts WHERE owner_id=$1", [owner]))[0]?.n,
        ) !== attemptsBefore
      )
        throw new Error("Recovery created another attempt");
    }
    const mock = await startMockAts(join(directory, "mock-ats-records"));
    let records: Array<{ jobId: string }>;
    try {
      records = (await mock.app.inject({ url: "/__test/records" })).json().records;
    } finally {
      await mock.app.close();
    }
    const accepted = [
      "accepted_before_receipt",
      "receipt_write_failed",
      "receipt_transaction_open",
      "receipt_before_task_complete",
    ].includes(boundary);
    if (
      records.length !== (accepted ? 1 : 0) ||
      new Set(records.map((record) => record.jobId)).size !== records.length
    )
      throw new Error("Mock external record count differs from the durable outcome");
    const receipts = Number(
      (await db.query("SELECT COUNT(*) AS n FROM receipts WHERE owner_id=$1", [owner]))[0]?.n,
    );
    if (receipts !== (accepted ? 1 : 0)) throw new Error("Recovery receipt count is inconsistent");
    if (
      outcome === "already_confirmed" &&
      (
        await db.query("SELECT state FROM tasks WHERE owner_id=$1 AND id=$2", [
          owner,
          String(task.id),
        ])
      )[0]?.state !== "completed"
    )
      throw new Error("Receipt-backed expired task was not completed");
    const resources = browserResources.snapshot();
    if (
      resources.browsers ||
      resources.contexts ||
      resources.openingBrowsers ||
      resources.openingContexts
    )
      throw new Error("Crash recovery leaked a browser");
    return {
      boundary,
      workerKilled: true,
      browserResourcesReleasedBeforeKill: true,
      writeTransactionInterrupted: ["intent_transaction_open", "receipt_transaction_open"].includes(
        boundary,
      ),
      databaseConsistencyVerified: true,
      applicationStateBeforeRecovery: app.state,
      outcome,
      attempts: attemptsBefore,
      intents: intentsBefore,
      acceptedMockRecords: records.length,
      receipts,
      duplicateRecords: 0,
    };
  } finally {
    await connected.db.close();
  }
}

export async function runCommitCrashMatrix() {
  const parent = await realpath(tmpdir()),
    directory = await mkdtemp(join(parent, "opencareers-capacity-crash-matrix-"));
  try {
    const cases = [];
    for (const boundary of commitCrashBoundaries) {
      const target = await mkdtemp(join(directory, "opencareers-capacity-crash-"));
      cases.push(await recoverCase(target, boundary));
    }
    return {
      status: "passed" as const,
      directory,
      cases,
      duplicateRecords: 0,
      leaseRecovery: "logical_clock_after_persisted_deadline" as const,
      realSubmissions: false,
      realModelCalls: false,
      productionReleaseAccepted: false,
      limits: [
        "Process kill follows browser cleanup; not a physical kill inside a live Chromium final click.",
        "Authorized-before-click uses an injected callback error before the process kill.",
        "Not a reboot, power-loss, private-employer or actual-duration soak test.",
      ],
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
