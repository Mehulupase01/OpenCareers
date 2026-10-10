import "../../../packages/config/src/env.js";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { createAdapterRegistry } from "../../../packages/browser/src/adapter-sdk.js";
import { loadConfig } from "../../../packages/config/src/index.js";
import {
  DomainError,
  FormDriftError,
  type TaskType,
} from "../../../packages/contracts/src/index.js";
import { runDiscovery } from "../../../packages/discovery/src/runner.js";
import { ArtifactStore } from "../../../packages/documents/src/artifact-store.js";
import { generatePacketContent } from "../../../packages/documents/src/domain.js";
import { buildPacket } from "../../../packages/documents/src/factory.js";
import { LetterDraftRunner } from "../../../packages/documents/src/letter-gateway.js";
import { GmailService } from "../../../packages/email/src/service.js";
import { MatchingRunner } from "../../../packages/inference/src/gateway.js";
import { OpenRouterTransport } from "../../../packages/inference/src/transport.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { BrowserRepository } from "../../../packages/persistence/src/browser-repository.js";
import { CandidateRepository } from "../../../packages/persistence/src/candidate-repository.js";
import { DiscoveryRepository } from "../../../packages/persistence/src/discovery-repository.js";
import { DocumentRepository } from "../../../packages/persistence/src/document-repository.js";
import { EmailRepository } from "../../../packages/persistence/src/email-repository.js";
import { HandoffRepository } from "../../../packages/persistence/src/handoff-repository.js";
import { connect } from "../../../packages/persistence/src/index.js";
import { MatchingRepository } from "../../../packages/persistence/src/matching-repository.js";
import { SubmissionRepository } from "../../../packages/persistence/src/submission-repository.js";
import { DocumentStorage } from "../../../packages/security/src/document-storage.js";
import { runInspectionTask } from "./inspection.js";

const logger = createLogger();
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
const config = loadConfig();
const repository = await connect(config);
await new CandidateRepository(repository.db, repository.ownerId).initialize();
const discovery = new DiscoveryRepository(repository.db, repository.ownerId);
const documents = new DocumentRepository(repository.db, repository.ownerId);
const browser = new BrowserRepository(repository.db, repository.ownerId);
const submissions = new SubmissionRepository(
  repository.db,
  repository.ownerId,
  undefined,
  config.profile !== "demo",
);
const artifacts = new ArtifactStore(
  config.dataDir,
  DocumentStorage.fromConfig(config, "document_artifact"),
);
await artifacts.initialize();
const adapters = createAdapterRegistry(config.dataDir);
const email = new EmailRepository(repository.db, repository.ownerId, config.vaultKey);
const gmail = new GmailService(email);
let nextMailSync = 0;
const matchingRepository = new MatchingRepository(repository.db, repository.ownerId);
const matching = new MatchingRunner(matchingRepository, config);
const letterDraftRunner = config.inference.apiKey
  ? new LetterDraftRunner(
      matchingRepository,
      config.inference.dailyLimit,
      new OpenRouterTransport(config.inference.apiKey, fetch, config.inference.privacyRevision),
      config.inference.privacyRevision,
    )
  : null;
const workerId = `scheduler-${randomUUID().slice(0, 8)}`;
try {
  while (!controller.signal.aborted) {
    try {
      await repository.heartbeat(workerId, "scheduler");
      if (config.profile !== "demo" && config.vaultKey && Date.now() >= nextMailSync) {
        nextMailSync = Date.now() + 300000;
        try {
          await gmail.sync();
        } catch {
          logger.warn("Read-only mailbox sync deferred.");
        }
      }
      await matching.run();
      const canPrepare =
        config.profile === "demo" ||
        (letterDraftRunner !== null &&
          (await matchingRepository.snapshot(config.inference.dailyLimit)).route.status ===
            "ready");
      const taskTypes: TaskType[] =
        config.profile === "demo"
          ? ["demo_probe", "prepare", "inspect", "submit", "reconcile"]
          : config.externalSubmissionEnabled
            ? canPrepare
              ? ["prepare", "inspect", "submit", "reconcile"]
              : ["inspect", "submit", "reconcile"]
            : canPrepare
              ? ["prepare"]
              : [];
      const task = await repository.claim(workerId, taskTypes);
      if (task) {
        let renewPending: Promise<void> = Promise.resolve();
        const renewTimer = setInterval(() => {
          renewPending = renewPending
            .then(() => repository.renew(task))
            .catch((error: unknown) => {
              logger.warn({ taskId: task.id, err: error }, "Task lease renewal failed");
            });
        }, 10_000);
        try {
          if (task.type === "prepare") {
            if (!task.applicationId || typeof task.payload.assessmentId !== "string")
              throw new DomainError("CONFIG_INVALID", "Prepare task payload is incomplete.");
            const retained = task.payload.refreshAnswers
              ? null
              : await documents.validPacket(task.payload.assessmentId, config.profile !== "demo");
            if (retained) {
              await documents.queueInspection(retained);
              logger.info(
                { taskId: task.id, applicationId: task.applicationId },
                "Existing valid packet retained",
              );
              await repository.complete(task);
              continue;
            }
            const application = (
              await repository.db.query(
                "SELECT revision,state FROM applications WHERE owner_id=$1 AND id=$2",
                [repository.ownerId, task.applicationId],
              )
            )[0];
            if (application?.state === "ELIGIBLE")
              await repository.transition(
                task.applicationId,
                Number(application.revision),
                "PREPARING",
              );
            const input = await documents.generationInput(
              task.applicationId,
              task.payload.assessmentId,
              (
                await repository.db.query(
                  "SELECT semantic_key,meaning,country FROM question_blocks WHERE owner_id=$1 AND application_id=$2",
                  [repository.ownerId, task.applicationId],
                )
              )
                .map((row) => ({
                  semanticKey: String(row.semantic_key),
                  meaning: String(row.meaning),
                  country: String(row.country),
                  maxCharacters: null,
                }))
                .filter((question) => /^[A-Z]{2}$/.test(question.country)),
              new Date().toISOString().slice(0, 10),
            );
            const letterDraft =
              config.profile === "demo"
                ? undefined
                : await letterDraftRunner?.draft(input, generatePacketContent(input));
            if (config.profile !== "demo" && !letterDraft)
              throw new DomainError("MODEL_ROUTE_INELIGIBLE", "LLM letter route is unavailable.");
            const packet = await documents.savePacket(
              await buildPacket(artifacts, input, letterDraft),
              {
                preserveValidAssessment: !task.payload.refreshAnswers,
              },
            );
            await documents.queueInspection(packet);
            logger.info({ taskId: task.id, applicationId: task.applicationId }, "Packet prepared");
          }
          if (task.type === "inspect")
            await runInspectionTask(task, {
              config,
              repository,
              documents,
              browser,
              artifacts,
              adapters,
            });
          if (task.type === "submit") {
            const packetId = task.payload.packetId;
            const preparationId = task.payload.preparationId;
            if (
              !task.applicationId ||
              typeof packetId !== "string" ||
              typeof preparationId !== "string"
            )
              throw new DomainError("CONFIG_INVALID", "Submit task payload is incomplete.");
            const packet = await documents.get(packetId);
            const preparation = (await browser.snapshot()).find(
              (item) => item.id === preparationId,
            );
            if (!packet?.valid || !preparation)
              throw new DomainError("PROFILE_STALE", "Submit task packet or preparation is stale.");
            const adapter = adapters.get(task.domain);
            let target: unknown;
            try {
              target = adapter.parseTarget(task.payload);
            } catch {
              throw new DomainError("CONFIG_INVALID", "Submission adapter target is invalid.");
            }
            const cv = await documents.artifact(packetId, "cv_pdf", artifacts);
            const browserSession =
              typeof task.payload.handoffId === "string"
                ? await new HandoffRepository(
                    repository.db,
                    repository.ownerId,
                    undefined,
                    config.vaultKey,
                  ).continuation(task.payload.handoffId, String(task.applicationId), packetId)
                : undefined;
            const app = (
              await repository.db.query(
                "SELECT revision FROM applications WHERE owner_id=$1 AND id=$2",
                [repository.ownerId, task.applicationId],
              )
            )[0];
            const handle = await submissions.begin(task, {
              packetId,
              preparationId,
              expectedRevision: Number(app?.revision),
            });
            let outcome: Awaited<ReturnType<typeof adapter.commit>> | null;
            try {
              outcome = await adapter.commit({
                packet,
                cvPdf: cv.buffer,
                preparation,
                target,
                ...(browserSession ? { browserSession } : {}),
                authorizeDispatch: () => submissions.authorizeDispatch(task, handle),
                validateAnswers: (snapshot, plan) =>
                  new CandidateRepository(repository.db, repository.ownerId).validateFormPlan(
                    packet,
                    snapshot,
                    plan,
                    { attemptId: handle.attemptId, fence: handle.fence },
                  ),
              });
            } catch (error) {
              if (
                !(error instanceof DomainError) ||
                ![
                  "FORM_CHANGED",
                  "ANSWER_UNKNOWN",
                  "PROFILE_STALE",
                  "POLICY_REVOKED",
                  "SESSION_EXPIRED",
                  "CLAIM_UNSUPPORTED",
                ].includes(error.code)
              )
                throw error;
              await submissions.abortBeforeDispatch(
                task,
                handle,
                error instanceof FormDriftError ? error.reason : "OTHER_FORM_CHANGED",
              );
              outcome = null;
              logger.warn(
                { taskId: task.id, applicationId: task.applicationId, adapterId: adapter.id },
                "Submission stopped before dispatch after canonical revalidation",
              );
            }
            if (outcome?.status === "confirmed") {
              const receiptId = await submissions.confirmReceipt(task, handle, outcome.evidence);
              logger.info(
                {
                  taskId: task.id,
                  applicationId: task.applicationId,
                  adapterId: adapter.id,
                  receiptId,
                },
                "Application receipt confirmed",
              );
            } else if (outcome) {
              await submissions.recordDefinitiveRejection(task, handle, outcome.reason);
              logger.info(
                { taskId: task.id, adapterId: adapter.id, reason: outcome.reason },
                "Adapter definitively rejected application",
              );
            }
          }
          if (task.type === "reconcile") {
            if (!task.applicationId)
              throw new DomainError("CONFIG_INVALID", "Reconcile task has no application.");
            const row = (
              await repository.db.query(
                "SELECT i.packet_id FROM attempts a JOIN intents i ON i.owner_id=a.owner_id AND i.id=a.intent_id WHERE a.owner_id=$1 AND a.application_id=$2 ORDER BY a.started_at DESC,a.id DESC LIMIT 1",
                [repository.ownerId, task.applicationId],
              )
            )[0];
            if (!row?.packet_id)
              throw new DomainError("NOT_FOUND", "Reconciliation packet is missing.");
            const packet = await documents.get(String(row.packet_id));
            const adapter = adapters.get(task.domain);
            let target: unknown;
            try {
              target = adapter.parseTarget(task.payload);
            } catch {
              throw new DomainError("CONFIG_INVALID", "Reconcile adapter target is invalid.");
            }
            const evidence =
              (await email.receipt(task.applicationId)) ??
              (await adapter.reconcile({ packet, target }));
            const outcome = await submissions.reconcileReceipt(task, evidence);
            logger.info(
              { taskId: task.id, adapterId: adapter.id, outcome },
              "Submission reconciled",
            );
          }
          await repository.complete(task);
          if (task.type === "demo_probe")
            logger.info({ taskId: task.id, fence: task.fence }, "Synthetic queue probe completed");
        } catch (error) {
          const domain =
            error instanceof DomainError
              ? error
              : new DomainError("STORAGE_UNAVAILABLE", "Packet preparation failed.", true);
          await repository.fail(task, domain);
          logger.warn({ err: error, taskId: task.id }, "Worker task failed");
        } finally {
          clearInterval(renewTimer);
          await renewPending;
        }
      }
      await runDiscovery(discovery, config.profile);
      await setTimeout(2000, undefined, { signal: controller.signal }).catch(() => undefined);
    } catch (error) {
      logger.error({ err: error }, "Worker iteration failed; retrying after backoff");
      await setTimeout(5000, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  }
} finally {
  await gmail.close();
  await repository.db.close();
}
