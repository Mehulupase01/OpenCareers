import { prepareHostedPacket } from "../../../packages/browser/src/hosted-prepare.js";
import type { HostedRead } from "../../../packages/browser/src/hosted-read.js";
import type { Config } from "../../../packages/config/src/index.js";
import type { PacketSnapshot } from "../../../packages/contracts/src/documents.js";
import { DomainError, type Task } from "../../../packages/contracts/src/index.js";
import type { BrowserRepository } from "../../../packages/persistence/src/browser-repository.js";
import { HostedOriginRepository } from "../../../packages/persistence/src/hosted-origin-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

export async function runHostedInspection(
  packet: PacketSnapshot,
  dependencies: {
    config: Pick<Config, "profile" | "externalSubmissionEnabled">;
    repository: Repository;
    browser: BrowserRepository;
    read?: HostedRead | undefined;
    task?: Task;
    clock?: (() => Date) | undefined;
  },
) {
  const { config, repository, browser, task } = dependencies;
  if (config.profile === "demo" || !config.externalSubmissionEnabled)
    throw new DomainError(
      "UNAUTHORIZED",
      "Public hosted preparation requires private enabled execution.",
    );
  if (
    !packet.valid ||
    packet.manifest.validation.status !== "valid" ||
    packet.manifest.letterGeneration?.method !== "llm"
  )
    throw new DomainError(
      "PROFILE_STALE",
      "Hosted preparation requires a valid packet with a validated LLM letter.",
    );
  if (task && (task.type !== "inspect" || task.applicationId !== packet.manifest.applicationId))
    throw new DomainError("CONFIG_INVALID", "Hosted inspection task does not match the packet.");
  await (task ? repository.renew(task) : Promise.resolve());
  const origins = new HostedOriginRepository(repository.db, repository.ownerId, dependencies.clock);
  const permission = await origins.active(new URL(packet.content.job.url).origin);
  if (!permission)
    throw new DomainError("POLICY_REVOKED", "Approve this hosted origin before preparation.");
  const application = (
    await repository.db.query(
      "SELECT revision,state FROM applications WHERE owner_id=$1 AND id=$2",
      [repository.ownerId, packet.manifest.applicationId],
    )
  )[0];
  if (
    !application ||
    [
      "READY",
      "IN_FLIGHT",
      "INTENT_RECORDED",
      "UNKNOWN",
      "RECONCILING",
      "NEEDS_REVIEW",
      "CONFIRMED",
      "HISTORICAL_SUBMITTED",
      "CLOSED",
      "SKIPPED",
      "DUPLICATE",
    ].includes(String(application.state))
  )
    throw new DomainError(
      "STATE_INVALID",
      "This application cannot enter generic hosted preparation.",
    );
  // Empty-plan preflight validates stored packet/policy bindings; it is not form or readiness evidence.
  const preflight = {
    url: packet.content.job.url,
    origin: permission.origin,
    jobId: packet.manifest.jobId,
    step: 1,
    fields: [],
    fingerprint: packet.manifest.contentSha256,
    blocker: "none" as const,
  };
  await origins.validatePlan(packet, permission, preflight, {
    fingerprint: preflight.fingerprint,
    entries: [],
    unresolved: [],
  });
  const result = await prepareHostedPacket(
    packet,
    permission,
    (snapshot, plan) => origins.validatePlan(packet, permission, snapshot, plan),
    dependencies.read,
  );
  if (task) await repository.renew(task);
  return browser.save(result, {
    expectedRevision: Number(application.revision),
    originPermission: permission,
  });
}
