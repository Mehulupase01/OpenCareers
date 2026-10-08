import type { AdapterRegistry } from "../../../packages/browser/src/adapter-sdk.js";
import type { Config } from "../../../packages/config/src/index.js";
import type { BrowserPreparation } from "../../../packages/contracts/src/browser.js";
import { DomainError, jobInputSchema, type Task } from "../../../packages/contracts/src/index.js";
import type { ArtifactStore } from "../../../packages/documents/src/artifact-store.js";
import type { BrowserRepository } from "../../../packages/persistence/src/browser-repository.js";
import { CandidateRepository } from "../../../packages/persistence/src/candidate-repository.js";
import type { DocumentRepository } from "../../../packages/persistence/src/document-repository.js";
import { ExceptionRepository } from "../../../packages/persistence/src/exception-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

export function inspectionTarget(applicationUrl: string, profile: Config["profile"]) {
  if (profile === "demo") {
    return { adapterId: "mock-ats", target: { fixture: "standard" } };
  }
  const url = new URL(applicationUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new DomainError("ADAPTER_UNSUPPORTED", "Unsupported application URL.");
  const tenant = /^([a-z0-9][a-z0-9-]{0,62})\.recruitee\.com$/.exec(url.hostname)?.[1];
  const offerSlug = /^\/o\/([a-zA-Z0-9][a-zA-Z0-9-]{0,119})\/?$/.exec(url.pathname)?.[1];
  if (tenant && offerSlug) return { adapterId: "recruitee", target: { tenant, offerSlug } };
  throw new DomainError(
    "ADAPTER_UNSUPPORTED",
    "This application target has no supported automatic inspection route.",
  );
}

export async function runInspectionTask(
  task: Task,
  dependencies: {
    config: Pick<Config, "profile" | "externalSubmissionEnabled">;
    repository: Repository;
    documents: DocumentRepository;
    browser: BrowserRepository;
    artifacts: ArtifactStore;
    adapters: AdapterRegistry;
    clock?: () => Date;
  },
) {
  const { config, repository, documents, browser, artifacts, adapters } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  if (task.type !== "inspect" || !task.applicationId || typeof task.payload.packetId !== "string")
    throw new DomainError("CONFIG_INVALID", "Inspection task payload is incomplete.");
  if (config.profile !== "demo" && !config.externalSubmissionEnabled)
    throw new DomainError("POLICY_REVOKED", "External application execution is disabled.");
  await repository.renew(task);
  const application = (
    await repository.db.query(
      "SELECT state,revision FROM applications WHERE owner_id=$1 AND id=$2",
      [repository.ownerId, task.applicationId],
    )
  )[0];
  if (!application) throw new DomainError("NOT_FOUND", "Inspection application was not found.");
  if (
    [
      "READY",
      "INTENT_RECORDED",
      "IN_FLIGHT",
      "UNKNOWN",
      "RECONCILING",
      "NEEDS_REVIEW",
      "CONFIRMED",
      "HISTORICAL_SUBMITTED",
      "SKIPPED",
      "CLOSED",
      "DUPLICATE",
    ].includes(String(application.state))
  )
    return;
  const packet = await documents.get(task.payload.packetId);
  if (
    !packet.valid ||
    packet.manifest.applicationId !== task.applicationId ||
    packet.manifest.validation.status !== "valid" ||
    (config.profile !== "demo" && packet.manifest.letterGeneration?.method !== "llm")
  )
    throw new DomainError(
      "PROFILE_STALE",
      "Inspection requires a valid, application-bound packet.",
    );
  const jobRow = (
    await repository.db.query(
      "SELECT j.data FROM applications a JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE a.owner_id=$1 AND a.id=$2",
      [repository.ownerId, task.applicationId],
    )
  )[0];
  if (!jobRow) throw new DomainError("NOT_FOUND", "Inspection vacancy was not found.");
  const job = jobInputSchema.parse(JSON.parse(String(jobRow.data)));
  if (
    job.id !== packet.manifest.jobId ||
    job.url !== packet.content.job.url ||
    (config.profile === "demo" && !job.synthetic)
  )
    throw new DomainError(
      "POLICY_REVOKED",
      "Inspection packet does not match the authorized vacancy.",
    );
  const candidates = new CandidateRepository(repository.db, repository.ownerId, clock);
  const candidate = await candidates.snapshot();
  if (
    candidate.profile?.id !== packet.manifest.profileId ||
    candidate.authorization?.id !== packet.manifest.authorizationId ||
    candidate.authorization.revision !== packet.manifest.authorizationRevision ||
    candidate.authorization.revokedAt ||
    Date.parse(candidate.authorization.effectiveAt) > clock().getTime() ||
    Date.parse(candidate.authorization.expiresAt) <= clock().getTime()
  )
    throw new DomainError("PROFILE_STALE", "Inspection packet inputs are no longer current.");
  const ambiguous = await repository.db.query(
    "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 AND (state<>'BLOCKED_BEFORE_DISPATCH' OR dispatch_started_at IS NOT NULL) LIMIT 1",
    [repository.ownerId, task.applicationId],
  );
  if (ambiguous.length)
    throw new DomainError(
      "DUPLICATE_SUSPECTED",
      "Reconcile the prior final action before inspecting again.",
    );
  let route: ReturnType<typeof inspectionTarget>;
  try {
    route = inspectionTarget(packet.content.job.url, config.profile);
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "ADAPTER_UNSUPPORTED") throw error;
    const app = (
      await repository.db.query(
        "SELECT state,revision FROM applications WHERE owner_id=$1 AND id=$2",
        [repository.ownerId, task.applicationId],
      )
    )[0];
    if (app && app.state !== "UNSUPPORTED")
      await repository.transition(task.applicationId, Number(app.revision), "UNSUPPORTED");
    await new ExceptionRepository(repository.db, repository.ownerId, clock).record({
      applicationId: task.applicationId,
      blocker: "unsupported_form",
      code: error.code,
      reason: error.message,
    });
    return;
  }
  const adapter = adapters.get(route.adapterId);
  const target = adapter.parseTarget(route.target) as Record<string, unknown>;
  const cv = await documents.artifact(packet.manifest.id, "cv_pdf", artifacts);
  const result = await adapter.prepare({ packet, cvPdf: cv.buffer, approvedValues: {}, target });
  await repository.renew(task);
  let preparation: BrowserPreparation;
  try {
    preparation = await browser.save(result, {
      expectedRevision: Number(application.revision),
      ...(candidate.authorization.mode === "auto_submit"
        ? { queueSubmit: { adapterId: adapter.id, target } }
        : {}),
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === "REVISION_STALE") return;
    throw error;
  }
  let unresolvedCount = 0;
  let reusableCount = 0;
  for (let index = 0; index < result.snapshots.length; index++) {
    const unresolved = result.plans[index]?.unresolved ?? [];
    for (const field of result.snapshots[index]?.fields ?? []) {
      if (unresolved.includes(field.semanticKey)) {
        unresolvedCount++;
        const reusable = await candidates.resolveQuestion(
          task.applicationId,
          field.semanticKey,
          field.label,
        );
        if (
          reusable &&
          !packet.content.answers.some(
            (answer) =>
              answer.semanticKey === field.semanticKey &&
              answer.meaning === field.label &&
              answer.status !== "deferred",
          )
        )
          reusableCount++;
      }
    }
  }
  if (result.status === "needs_input" && unresolvedCount && reusableCount === unresolvedCount)
    await repository.enqueue({
      type: "prepare",
      domain: "documents",
      applicationId: task.applicationId,
      dedupeKey: `prepare:answers:${preparation.id}`,
      payload: {
        schemaVersion: 1,
        assessmentId: packet.manifest.assessmentId,
        refreshAnswers: true,
      },
      priority: 20,
    });
  if (result.status === "challenge" || result.status === "unsupported") {
    await new ExceptionRepository(repository.db, repository.ownerId, clock).record({
      applicationId: task.applicationId,
      blocker: result.status === "challenge" ? "challenge_required" : "unsupported_form",
      code: result.status === "challenge" ? "CHALLENGE_REQUIRED" : "ADAPTER_UNSUPPORTED",
      reason: result.issues[0] ?? "The form needs owner review.",
    });
  }
}
