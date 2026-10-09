import { createHash, randomUUID } from "node:crypto";
import { dryRunResultSchema } from "../../contracts/src/browser.js";
import {
  type PacketManifest,
  packetContentSchema,
  packetManifestSchema,
} from "../../contracts/src/documents.js";
import { DomainError, type FormDriftReason, type Task } from "../../contracts/src/index.js";
import {
  type GreenhouseReceiptEvidence,
  greenhouseReceiptEvidenceSchema,
  type MockReceiptEvidence,
  mockReceiptEvidenceSchema,
  type ReceiptEvidence,
  type RecruiteeReceiptEvidence,
  receiptEvidenceSchema,
  recruiteeReceiptEvidenceSchema,
} from "../../contracts/src/submission.js";
import { assertTransition } from "../../domain/src/state.js";
import { CandidateRepository } from "./candidate-repository.js";
import type { Database, SqlExecutor } from "./database.js";
import { Repository } from "./repository.js";
import { assertNoRestoreReplay } from "./restore-repository.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function assertExternalLetter(
  manifest: PacketManifest,
  adapterId: string,
  requireLlmExternal: boolean,
) {
  if (requireLlmExternal && adapterId !== "mock-ats" && manifest.letterGeneration?.method !== "llm")
    throw new DomainError(
      "CLAIM_UNSUPPORTED",
      "A validated LLM letter is required before external submission.",
    );
}

export interface CommitHandle {
  intentId: string;
  attemptId: string;
  applicationId: string;
  packetId: string;
  preparationId: string;
  fence: number;
}

export class SubmissionRepository extends Repository {
  constructor(
    db: Database,
    ownerId: string,
    clock?: () => Date,
    private readonly requireLlmExternal = false,
  ) {
    super(db, ownerId, clock);
  }

  private async assertLease(tx: SqlExecutor, task: Task, type: "submit" | "reconcile" = "submit") {
    const row = (
      await tx.query(
        "SELECT id FROM tasks WHERE owner_id=$1 AND id=$2 AND application_id=$3 AND type=$4 AND state='leased' AND fence=$5 AND lease_owner=$6 AND lease_until>$7",
        [this.ownerId, task.id, task.applicationId, type, task.fence, task.leaseOwner, this.now()],
      )
    )[0];
    if (!row) throw new DomainError("LEASE_STALE", "Submit task lease is no longer current.");
  }

  async begin(
    task: Task,
    input: { packetId: string; preparationId: string; expectedRevision: number },
  ): Promise<CommitHandle> {
    const applicationId = task.applicationId;
    if (!applicationId) throw new DomainError("STATE_INVALID", "Submit task has no application.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.assertLease(tx, task);
      await assertNoRestoreReplay(tx, this.ownerId, applicationId);
      const control = await this.readControl(tx);
      if (control.restoreBlocked || control.stopped || control.submissionsPaused)
        throw new DomainError("POLICY_REVOKED", "Submission controls prohibit a new intent.");
      let handoffBoundary = 0;
      const app = (
        await tx.query(
          "SELECT state,revision,commit_fence,job_id FROM applications WHERE owner_id=$1 AND id=$2",
          [this.ownerId, applicationId],
        )
      )[0];
      if (app?.state !== "READY")
        throw new DomainError("STATE_INVALID", "Application is not ready for a final action.");
      const activeHandoff = await tx.query(
        "SELECT id FROM handoff_sessions WHERE owner_id=$1 AND application_id=$2 AND state IN ('open','claimed','rebuilding') AND expires_at>$3 LIMIT 1",
        [this.ownerId, applicationId, this.now()],
      );
      if (activeHandoff.length)
        throw new DomainError("STATE_INVALID", "An active human handoff blocks final action.");
      // A handoff that has completed or expired does not by itself unblock the
      // final action. The preparation must postdate it, because a preparation
      // inspected before the challenge cannot describe the form as it is now, and
      // reusing it is exactly how a stale form gets submitted.
      const settled = (
        await tx.query(
          "SELECT completed_at,expires_at FROM handoff_sessions WHERE owner_id=$1 AND application_id=$2 AND (completed_at IS NOT NULL OR expires_at<=$3) ORDER BY created_at DESC LIMIT 1",
          [this.ownerId, applicationId, this.now()],
        )
      )[0];
      if (settled) handoffBoundary = Date.parse(String(settled.completed_at ?? settled.expires_at));
      if (Number(app.revision) !== input.expectedRevision)
        throw new DomainError("REVISION_STALE", "Application revision changed.");
      if (Number(app.commit_fence) !== task.fence)
        throw new DomainError("LEASE_STALE", "Commit fence changed.");
      const packet = (
        await tx.query(
          "SELECT p.manifest FROM packets p LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE p.owner_id=$1 AND p.id=$2 AND p.application_id=$3 AND v.packet_id IS NULL",
          [this.ownerId, input.packetId, applicationId],
        )
      )[0];
      if (!packet) throw new DomainError("PROFILE_STALE", "Packet is missing or invalid.");
      const manifest = packetManifestSchema.parse(JSON.parse(String(packet.manifest)));
      if (manifest.validation.status !== "valid" || manifest.jobId !== app.job_id)
        throw new DomainError("PROFILE_STALE", "Packet does not match the ready job.");
      assertExternalLetter(manifest, task.domain, this.requireLlmExternal);
      const preparation = (
        await tx.query(
          "SELECT status,result,created_at FROM browser_preparations WHERE owner_id=$1 AND id=$2 AND application_id=$3 AND packet_id=$4",
          [this.ownerId, input.preparationId, applicationId, input.packetId],
        )
      )[0];
      if (preparation?.status !== "ready")
        throw new DomainError("FORM_CHANGED", "A ready browser preparation is required.");
      // A form inspected before a challenge was handed off cannot describe the
      // form as it is now. The preparation must be newer than the settled
      // handoff, otherwise the safe action is to rebuild, never to reuse.
      if (handoffBoundary && Date.parse(String(preparation.created_at)) <= handoffBoundary)
        throw new DomainError(
          "FORM_CHANGED",
          "The form was rebuilt after a challenge handoff. Rebuild it before the final action.",
        );
      const latest = (
        await tx.query(
          "SELECT id FROM browser_preparations WHERE owner_id=$1 AND application_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
          [this.ownerId, applicationId],
        )
      )[0];
      if (
        latest?.id !== input.preparationId ||
        Date.parse(String(preparation.created_at)) > this.clock().getTime() ||
        this.clock().getTime() - Date.parse(String(preparation.created_at)) > 30 * 60 * 1000
      )
        throw new DomainError("FORM_CHANGED", "Browser preparation is stale.");
      const result = dryRunResultSchema.parse(JSON.parse(String(preparation.result)));
      if (result.status !== "ready" || result.serverApplicationCount !== 0)
        throw new DomainError("FORM_CHANGED", "Browser preparation is not commit-ready.");
      if (result.adapter?.id !== task.domain)
        throw new DomainError("FORM_CHANGED", "Task adapter does not match its preparation.");
      const prior = await tx.query(
        "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 AND (state<>'BLOCKED_BEFORE_DISPATCH' OR dispatch_started_at IS NOT NULL) LIMIT 1",
        [this.ownerId, applicationId],
      );
      if (prior.length)
        throw new DomainError(
          "DUPLICATE_SUSPECTED",
          "A prior final action requires reconciliation.",
        );
      const candidate = new CandidateRepository(this.db, this.ownerId, this.clock);
      const policy = await candidate.checkCommit(tx, {
        applicationId,
        authorizationId: manifest.authorizationId,
        profileVersionId: manifest.profileId,
      });
      if (policy.revision !== manifest.authorizationRevision)
        throw new DomainError("POLICY_REVOKED", "Packet authorization revision changed.");
      const snapshot = {
        applicationId,
        taskId: task.id,
        adapter: task.domain,
        adapterVersion: result.adapter.version,
        targetFingerprint: result.adapter.targetFingerprint,
        jobId: manifest.jobId,
        packetId: manifest.id,
        packetArtifacts: manifest.artifacts.map((artifact) => ({
          kind: artifact.kind,
          sha256: artifact.sha256,
        })),
        preparationId: input.preparationId,
        formFingerprints: result.snapshots.map((item) => item.fingerprint),
        formUrls: result.snapshots.map((item) => item.url),
        authorizationId: policy.id,
        authorizationRevision: policy.revision,
        profileId: manifest.profileId,
        fence: task.fence,
        handoffId: typeof task.payload.handoffId === "string" ? task.payload.handoffId : null,
      };
      const intentId = randomUUID();
      const attemptId = randomUUID();
      await tx.query(
        "INSERT INTO intents(id,owner_id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          intentId,
          this.ownerId,
          applicationId,
          input.packetId,
          policy.id,
          JSON.stringify(snapshot),
          digest(snapshot),
          this.now(),
        ],
      );
      assertTransition("READY", "INTENT_RECORDED");
      assertTransition("INTENT_RECORDED", "IN_FLIGHT");
      const updated = await tx.query(
        "UPDATE applications SET state='IN_FLIGHT',revision=revision+2,updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state='READY' AND revision=$4 AND commit_fence=$5 RETURNING revision",
        [this.now(), this.ownerId, applicationId, input.expectedRevision, task.fence],
      );
      if (!updated[0]) throw new DomainError("REVISION_STALE", "Commit state changed.");
      await tx.query(
        "INSERT INTO attempts(id,owner_id,application_id,intent_id,fence,state,started_at) VALUES($1,$2,$3,$4,$5,'IN_FLIGHT',$6)",
        [attemptId, this.ownerId, applicationId, intentId, task.fence, this.now()],
      );
      await this.audit(tx, applicationId, "submission.intent_recorded", Number(app.revision) + 1, {
        intentId,
      });
      await this.audit(tx, applicationId, "submission.in_flight", Number(updated[0].revision), {
        attemptId,
        fence: task.fence,
      });
      return {
        intentId,
        attemptId,
        applicationId,
        packetId: input.packetId,
        preparationId: input.preparationId,
        fence: task.fence,
      };
    });
  }

  async abortBeforeDispatch(
    task: Task,
    handle: CommitHandle,
    driftReason: FormDriftReason = "OTHER_FORM_CHANGED",
  ): Promise<void> {
    if (task.applicationId !== handle.applicationId || task.fence !== handle.fence)
      throw new DomainError("LEASE_STALE", "Commit handle does not match the leased task.");
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.assertLease(tx, task);
      const row = (
        await tx.query(
          "SELECT a.state,a.revision,a.commit_fence,t.state AS attempt_state,t.dispatch_started_at,i.snapshot,i.sha256 FROM attempts t JOIN applications a ON a.owner_id=t.owner_id AND a.id=t.application_id JOIN intents i ON i.owner_id=t.owner_id AND i.id=t.intent_id WHERE t.owner_id=$1 AND t.id=$2 AND t.intent_id=$3 AND t.application_id=$4",
          [this.ownerId, handle.attemptId, handle.intentId, handle.applicationId],
        )
      )[0];
      if (
        row?.state !== "IN_FLIGHT" ||
        row.attempt_state !== "IN_FLIGHT" ||
        Number(row.commit_fence) !== handle.fence ||
        row.dispatch_started_at
      )
        throw new DomainError(
          "STATE_INVALID",
          "A dispatched attempt cannot be marked pre-dispatch blocked.",
        );
      const snapshot = JSON.parse(String(row.snapshot)) as { taskId?: string };
      if (digest(snapshot) !== row.sha256 || snapshot.taskId !== task.id)
        throw new DomainError("FORM_CHANGED", "Pre-dispatch attempt is not bound to this task.");
      assertTransition("IN_FLIGHT", "UNSUPPORTED");
      const attempt = await tx.query(
        "UPDATE attempts SET state='BLOCKED_BEFORE_DISPATCH',ended_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT' AND dispatch_started_at IS NULL RETURNING id",
        [this.now(), this.ownerId, handle.attemptId],
      );
      if (!attempt[0])
        throw new DomainError("STATE_INVALID", "Attempt changed before pre-dispatch abort.");
      const updated = await tx.query(
        "UPDATE applications SET state='UNSUPPORTED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT' AND commit_fence=$4 RETURNING revision",
        [this.now(), this.ownerId, handle.applicationId, handle.fence],
      );
      if (!updated[0])
        throw new DomainError("REVISION_STALE", "Application changed before pre-dispatch abort.");
      await this.audit(
        tx,
        handle.applicationId,
        "submission.pre_dispatch_blocked",
        Number(updated[0].revision),
        {
          attemptId: handle.attemptId,
          reason: "FORM_CHANGED",
          driftReason,
        },
      );
    });
  }

  async authorizeDispatch(task: Task, handle: CommitHandle): Promise<{ expiresAt: string }> {
    if (task.applicationId !== handle.applicationId || task.fence !== handle.fence)
      throw new DomainError("LEASE_STALE", "Commit handle does not match the leased task.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.assertLease(tx, task);
      const row = (
        await tx.query(
          "SELECT a.state,a.commit_fence,t.state AS attempt_state,t.dispatch_started_at,i.snapshot,i.sha256,i.authorization_id,c.active_authorization_id,c.active_profile_id,u.revision AS authorization_revision,u.revoked_at,u.effective_at,u.expires_at FROM attempts t JOIN applications a ON a.owner_id=t.owner_id AND a.id=t.application_id JOIN intents i ON i.owner_id=t.owner_id AND i.id=t.intent_id JOIN candidates c ON c.owner_id=t.owner_id JOIN authorizations u ON u.owner_id=i.owner_id AND u.id=i.authorization_id LEFT JOIN intent_validity v ON v.owner_id=i.owner_id AND v.intent_id=i.id WHERE t.owner_id=$1 AND t.id=$2 AND t.intent_id=$3 AND t.application_id=$4 AND v.intent_id IS NULL",
          [this.ownerId, handle.attemptId, handle.intentId, handle.applicationId],
        )
      )[0];
      if (row?.state !== "IN_FLIGHT" || row.attempt_state !== "IN_FLIGHT")
        throw new DomainError("STATE_INVALID", "Submission attempt is not in flight.");
      if (Number(row.commit_fence) !== handle.fence || row.dispatch_started_at)
        throw new DomainError("LEASE_STALE", "Dispatch capability is stale or already used.");
      const snapshot = JSON.parse(String(row.snapshot)) as {
        taskId: string;
        packetId: string;
        preparationId: string;
        profileId: string;
        authorizationRevision: number;
        fence: number;
        handoffId?: string | null;
      };
      if (
        digest(snapshot) !== row.sha256 ||
        snapshot.taskId !== task.id ||
        snapshot.packetId !== handle.packetId ||
        snapshot.preparationId !== handle.preparationId ||
        snapshot.fence !== handle.fence
      )
        throw new DomainError("FORM_CHANGED", "Commit intent binding changed.");
      const control = await this.readControl(tx);
      await assertNoRestoreReplay(tx, this.ownerId, handle.applicationId);
      if (
        control.stopped ||
        control.submissionsPaused ||
        control.restoreBlocked ||
        row.active_authorization_id !== row.authorization_id ||
        row.active_profile_id !== snapshot.profileId ||
        Number(row.authorization_revision) !== snapshot.authorizationRevision ||
        row.revoked_at ||
        String(row.effective_at) > this.now() ||
        String(row.expires_at) <= this.now()
      )
        throw new DomainError("POLICY_REVOKED", "Standing authorization changed before dispatch.");
      if (snapshot.handoffId) {
        const continuation = (
          await tx.query(
            "SELECT h.id FROM handoff_sessions h JOIN handoff_continuations k ON k.owner_id=h.owner_id AND k.handoff_id=h.id WHERE h.owner_id=$1 AND h.id=$2 AND h.application_id=$3 AND h.state='completed' AND h.generation=k.generation AND h.expires_at>$4 AND k.expires_at=h.expires_at AND k.packet_id=$5",
            [this.ownerId, snapshot.handoffId, handle.applicationId, this.now(), handle.packetId],
          )
        )[0];
        if (!continuation)
          throw new DomainError("FORM_CHANGED", "Browser continuation changed before dispatch.");
      }
      const preparedRow = (
        await tx.query(
          "SELECT b.result,p.manifest,c.content FROM browser_preparations b JOIN packets p ON p.owner_id=b.owner_id AND p.id=b.packet_id JOIN packet_contents c ON c.owner_id=p.owner_id AND c.packet_id=p.id WHERE b.owner_id=$1 AND b.id=$2 AND b.application_id=$3 AND p.id=$4",
          [this.ownerId, handle.preparationId, handle.applicationId, handle.packetId],
        )
      )[0];
      if (!preparedRow) throw new DomainError("FORM_CHANGED", "Prepared answers are missing.");
      const prepared = dryRunResultSchema.parse(JSON.parse(String(preparedRow.result)));
      const packet = {
        manifest: packetManifestSchema.parse(JSON.parse(String(preparedRow.manifest))),
        content: packetContentSchema.parse(JSON.parse(String(preparedRow.content))),
        valid: true,
        invalidReason: null,
      };
      const candidates = new CandidateRepository(this.db, this.ownerId, this.clock);
      if (prepared.snapshots.length !== prepared.plans.length)
        throw new DomainError("FORM_CHANGED", "Prepared answer steps changed.");
      for (const [index, form] of prepared.snapshots.entries()) {
        const plan = prepared.plans[index];
        if (!plan) throw new DomainError("FORM_CHANGED", "Prepared answer plan is missing.");
        const checked = await candidates.validateFormPlanIn(tx, packet, form, plan, handle);
        const values = (entries: typeof plan.entries) =>
          JSON.stringify(
            entries.map(({ name, semanticKey, expected }) => ({ name, semanticKey, expected })),
          );
        if (checked.unresolved.length || values(checked.entries) !== values(plan.entries))
          throw new DomainError(
            "ANSWER_UNKNOWN",
            "Prepared answers are no longer canonically approved.",
          );
      }
      const updated = await tx.query(
        "UPDATE attempts SET dispatch_started_at=$1 WHERE owner_id=$2 AND id=$3 AND dispatch_started_at IS NULL RETURNING id",
        [this.now(), this.ownerId, handle.attemptId],
      );
      if (!updated[0]) throw new DomainError("LEASE_STALE", "Dispatch was already claimed.");
      await this.audit(tx, handle.attemptId, "submission.dispatch_started", handle.fence);
      return { expiresAt: new Date(this.clock().getTime() + 10000).toISOString() };
    });
  }

  async confirmMockReceipt(
    task: Task,
    handle: CommitHandle,
    evidenceInput: MockReceiptEvidence,
  ): Promise<string> {
    const evidence = mockReceiptEvidenceSchema.parse(evidenceInput);
    if (task.applicationId !== handle.applicationId || task.fence !== handle.fence)
      throw new DomainError("LEASE_STALE", "Receipt handle does not match the leased task.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.assertLease(tx, task);
      const row = (
        await tx.query(
          "SELECT a.state,a.revision,a.commit_fence,t.state AS attempt_state,t.dispatch_started_at,i.snapshot,i.sha256,c.content FROM attempts t JOIN applications a ON a.owner_id=t.owner_id AND a.id=t.application_id JOIN intents i ON i.owner_id=t.owner_id AND i.id=t.intent_id JOIN packet_contents c ON c.owner_id=i.owner_id AND c.packet_id=i.packet_id WHERE t.owner_id=$1 AND t.id=$2 AND t.intent_id=$3 AND t.application_id=$4",
          [this.ownerId, handle.attemptId, handle.intentId, handle.applicationId],
        )
      )[0];
      if (
        row?.state !== "IN_FLIGHT" ||
        row.attempt_state !== "IN_FLIGHT" ||
        !row.dispatch_started_at
      )
        throw new DomainError("STATE_INVALID", "A dispatched in-flight attempt is required.");
      if (Number(row.commit_fence) !== handle.fence)
        throw new DomainError("LEASE_STALE", "Commit fence changed before receipt confirmation.");
      const snapshot = JSON.parse(String(row.snapshot)) as { jobId: string };
      const content = packetContentSchema.parse(JSON.parse(String(row.content)));
      const receiptUrl = new URL(evidence.receiptUrl);
      if (
        digest(snapshot) !== row.sha256 ||
        evidence.jobId !== snapshot.jobId ||
        content.job.id !== evidence.jobId ||
        evidence.emailHash !== digestEmail(content.cv.identity.email) ||
        receiptUrl.protocol !== "http:" ||
        receiptUrl.hostname !== "127.0.0.1" ||
        receiptUrl.pathname !== `/receipts/${evidence.recordId}`
      )
        throw new DomainError(
          "RECEIPT_UNCORRELATED",
          "Receipt does not match the intent and packet.",
        );
      assertTransition("IN_FLIGHT", "CONFIRMED");
      const receiptId = randomUUID();
      const hash = digest(evidence);
      await tx.query(
        "INSERT INTO receipts(id,owner_id,application_id,attempt_id,evidence,sha256,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          receiptId,
          this.ownerId,
          handle.applicationId,
          handle.attemptId,
          JSON.stringify(evidence),
          hash,
          this.now(),
        ],
      );
      await tx.query(
        "UPDATE attempts SET state='CONFIRMED',ended_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT'",
        [this.now(), this.ownerId, handle.attemptId],
      );
      const updated = await tx.query(
        "UPDATE applications SET state='CONFIRMED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT' AND commit_fence=$4 RETURNING revision",
        [this.now(), this.ownerId, handle.applicationId, handle.fence],
      );
      if (!updated[0])
        throw new DomainError("REVISION_STALE", "Application changed before confirmation.");
      await this.audit(
        tx,
        handle.applicationId,
        "submission.confirmed",
        Number(updated[0].revision),
        { receiptId },
      );
      return receiptId;
    });
  }

  async confirmReceipt(
    task: Task,
    handle: CommitHandle,
    evidenceInput: ReceiptEvidence,
  ): Promise<string> {
    const evidence = receiptEvidenceSchema.parse(evidenceInput);
    return evidence.kind === "mock_ats"
      ? this.confirmMockReceipt(task, handle, evidence)
      : evidence.kind === "recruitee"
        ? this.confirmRecruiteeReceipt(task, handle, evidence)
        : this.confirmGreenhouseReceipt(task, handle, evidence);
  }

  async recordDefinitiveMockRejection(task: Task, handle: CommitHandle): Promise<void> {
    return this.recordDefinitiveRejection(task, handle, "MOCK_VALIDATION_REJECTED");
  }

  async confirmRecruiteeReceipt(
    task: Task,
    handle: CommitHandle,
    evidenceInput: RecruiteeReceiptEvidence,
  ): Promise<string> {
    const evidence = recruiteeReceiptEvidenceSchema.parse(evidenceInput);
    if (task.applicationId !== handle.applicationId || task.fence !== handle.fence)
      throw new DomainError("LEASE_STALE", "Receipt handle does not match the leased task.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.assertLease(tx, task);
      const row = (
        await tx.query(
          "SELECT a.state,a.commit_fence,t.state AS attempt_state,t.dispatch_started_at,i.snapshot,i.sha256,c.content FROM attempts t JOIN applications a ON a.owner_id=t.owner_id AND a.id=t.application_id JOIN intents i ON i.owner_id=t.owner_id AND i.id=t.intent_id JOIN packet_contents c ON c.owner_id=i.owner_id AND c.packet_id=i.packet_id WHERE t.owner_id=$1 AND t.id=$2 AND t.intent_id=$3 AND t.application_id=$4",
          [this.ownerId, handle.attemptId, handle.intentId, handle.applicationId],
        )
      )[0];
      if (
        row?.state !== "IN_FLIGHT" ||
        row.attempt_state !== "IN_FLIGHT" ||
        !row.dispatch_started_at
      )
        throw new DomainError("STATE_INVALID", "A dispatched in-flight attempt is required.");
      if (Number(row.commit_fence) !== handle.fence)
        throw new DomainError("LEASE_STALE", "Commit fence changed before receipt confirmation.");
      const snapshot = JSON.parse(String(row.snapshot)) as {
        jobId: string;
        formUrls: string[];
      };
      const content = packetContentSchema.parse(JSON.parse(String(row.content)));
      const responseUrl = new URL(evidence.responseUrl);
      const expectedOfferUrl = `https://${evidence.tenant}.recruitee.com/api/offers/${encodeURIComponent(evidence.offerSlug)}`;
      if (
        digest(snapshot) !== row.sha256 ||
        evidence.jobId !== snapshot.jobId ||
        content.job.id !== evidence.jobId ||
        evidence.emailHash !== digestEmail(content.cv.identity.email) ||
        !snapshot.formUrls?.includes(expectedOfferUrl) ||
        responseUrl.protocol !== "https:" ||
        responseUrl.hostname !== `${evidence.tenant}.recruitee.com` ||
        responseUrl.pathname !== `/api/offers/${evidence.offerSlug}/candidates` ||
        responseUrl.search !== "?async=true"
      )
        throw new DomainError(
          "RECEIPT_UNCORRELATED",
          "Recruitee receipt does not match the intent and packet.",
        );
      assertTransition("IN_FLIGHT", "CONFIRMED");
      const receiptId = randomUUID();
      await tx.query(
        "INSERT INTO receipts(id,owner_id,application_id,attempt_id,evidence,sha256,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          receiptId,
          this.ownerId,
          handle.applicationId,
          handle.attemptId,
          JSON.stringify(evidence),
          digest(evidence),
          this.now(),
        ],
      );
      await tx.query(
        "UPDATE attempts SET state='CONFIRMED',ended_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT'",
        [this.now(), this.ownerId, handle.attemptId],
      );
      const updated = await tx.query(
        "UPDATE applications SET state='CONFIRMED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT' AND commit_fence=$4 RETURNING revision",
        [this.now(), this.ownerId, handle.applicationId, handle.fence],
      );
      if (!updated[0])
        throw new DomainError("REVISION_STALE", "Application changed before confirmation.");
      await this.audit(
        tx,
        handle.applicationId,
        "submission.confirmed",
        Number(updated[0].revision),
        { receiptId, provider: "recruitee", externalCandidateId: evidence.candidateId },
      );
      return receiptId;
    });
  }

  async confirmGreenhouseReceipt(
    task: Task,
    handle: CommitHandle,
    evidenceInput: GreenhouseReceiptEvidence,
  ): Promise<string> {
    const evidence = greenhouseReceiptEvidenceSchema.parse(evidenceInput);
    if (task.applicationId !== handle.applicationId || task.fence !== handle.fence)
      throw new DomainError("LEASE_STALE", "Receipt handle does not match the leased task.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.assertLease(tx, task);
      const row = (
        await tx.query(
          "SELECT a.state,a.commit_fence,t.state AS attempt_state,t.dispatch_started_at,i.snapshot,i.sha256,c.content FROM attempts t JOIN applications a ON a.owner_id=t.owner_id AND a.id=t.application_id JOIN intents i ON i.owner_id=t.owner_id AND i.id=t.intent_id JOIN packet_contents c ON c.owner_id=i.owner_id AND c.packet_id=i.packet_id WHERE t.owner_id=$1 AND t.id=$2 AND t.intent_id=$3 AND t.application_id=$4",
          [this.ownerId, handle.attemptId, handle.intentId, handle.applicationId],
        )
      )[0];
      if (
        row?.state !== "IN_FLIGHT" ||
        row.attempt_state !== "IN_FLIGHT" ||
        !row.dispatch_started_at ||
        Number(row.commit_fence) !== handle.fence
      )
        throw new DomainError("STATE_INVALID", "A dispatched in-flight attempt is required.");
      const snapshot = JSON.parse(String(row.snapshot)) as { jobId: string; formUrls: string[] };
      const content = packetContentSchema.parse(JSON.parse(String(row.content)));
      const receiptUrl = new URL(evidence.receiptUrl);
      const expectedPath = `/${evidence.board}/jobs/${evidence.postingId}`;
      const expectedFormUrl = `https://job-boards.greenhouse.io${expectedPath}`;
      if (
        digest(snapshot) !== row.sha256 ||
        evidence.jobId !== snapshot.jobId ||
        content.job.id !== evidence.jobId ||
        evidence.emailHash !== digestEmail(content.cv.identity.email) ||
        !snapshot.formUrls?.some((url) => new URL(url).pathname === expectedPath) ||
        !snapshot.formUrls?.some(
          (url) => new URL(url).origin === new URL(expectedFormUrl).origin,
        ) ||
        receiptUrl.origin !== "https://job-boards.greenhouse.io" ||
        receiptUrl.pathname !== expectedPath ||
        receiptUrl.searchParams.get("receipt") !== evidence.receiptId
      )
        throw new DomainError(
          "RECEIPT_UNCORRELATED",
          "Greenhouse receipt does not match the intent and packet.",
        );
      assertTransition("IN_FLIGHT", "CONFIRMED");
      const receiptId = randomUUID();
      await tx.query(
        "INSERT INTO receipts(id,owner_id,application_id,attempt_id,evidence,sha256,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          receiptId,
          this.ownerId,
          handle.applicationId,
          handle.attemptId,
          JSON.stringify(evidence),
          digest(evidence),
          this.now(),
        ],
      );
      await tx.query(
        "UPDATE attempts SET state='CONFIRMED',ended_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT'",
        [this.now(), this.ownerId, handle.attemptId],
      );
      const updated = await tx.query(
        "UPDATE applications SET state='CONFIRMED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT' AND commit_fence=$4 RETURNING revision",
        [this.now(), this.ownerId, handle.applicationId, handle.fence],
      );
      if (!updated[0])
        throw new DomainError("REVISION_STALE", "Application changed before confirmation.");
      await this.audit(
        tx,
        handle.applicationId,
        "submission.confirmed",
        Number(updated[0].revision),
        { receiptId, provider: "greenhouse", externalReceiptId: evidence.receiptId },
      );
      return receiptId;
    });
  }

  async recordDefinitiveRejection(
    task: Task,
    handle: CommitHandle,
    reason:
      | "MOCK_VALIDATION_REJECTED"
      | "RECRUITEE_VALIDATION_REJECTED"
      | "GREENHOUSE_VALIDATION_REJECTED",
  ): Promise<void> {
    if (task.applicationId !== handle.applicationId || task.fence !== handle.fence)
      throw new DomainError("LEASE_STALE", "Rejection handle does not match the leased task.");
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.assertLease(tx, task);
      const row = (
        await tx.query(
          "SELECT a.state,a.commit_fence,t.state AS attempt_state,t.dispatch_started_at FROM attempts t JOIN applications a ON a.owner_id=t.owner_id AND a.id=t.application_id WHERE t.owner_id=$1 AND t.id=$2 AND t.intent_id=$3 AND t.application_id=$4",
          [this.ownerId, handle.attemptId, handle.intentId, handle.applicationId],
        )
      )[0];
      if (
        row?.state !== "IN_FLIGHT" ||
        row.attempt_state !== "IN_FLIGHT" ||
        !row.dispatch_started_at ||
        Number(row.commit_fence) !== handle.fence
      )
        throw new DomainError("STATE_INVALID", "A dispatched in-flight attempt is required.");
      assertTransition("IN_FLIGHT", "DEFINITIVE_FAILURE");
      await tx.query(
        "UPDATE attempts SET state='DEFINITIVE_FAILURE',ended_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT'",
        [this.now(), this.ownerId, handle.attemptId],
      );
      const updated = await tx.query(
        "UPDATE applications SET state='DEFINITIVE_FAILURE',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state='IN_FLIGHT' AND commit_fence=$4 RETURNING revision",
        [this.now(), this.ownerId, handle.applicationId, handle.fence],
      );
      if (!updated[0])
        throw new DomainError("REVISION_STALE", "Application changed after rejection.");
      await this.audit(
        tx,
        handle.applicationId,
        "submission.definitive_failure",
        Number(updated[0].revision),
        {
          reason,
        },
      );
    });
  }

  async reconcileMockReceipt(
    task: Task,
    evidenceInput: MockReceiptEvidence | null,
  ): Promise<"confirmed" | "needs_review"> {
    const applicationId = task.applicationId;
    if (!applicationId)
      throw new DomainError("STATE_INVALID", "Reconciliation task has no application.");
    const evidence = evidenceInput ? mockReceiptEvidenceSchema.parse(evidenceInput) : null;
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.assertLease(tx, task, "reconcile");
      const row = (
        await tx.query(
          "SELECT a.state,a.revision,t.id AS attempt_id,t.state AS attempt_state,i.snapshot,i.sha256,c.content FROM applications a JOIN attempts t ON t.owner_id=a.owner_id AND t.application_id=a.id JOIN intents i ON i.owner_id=t.owner_id AND i.id=t.intent_id JOIN packet_contents c ON c.owner_id=i.owner_id AND c.packet_id=i.packet_id WHERE a.owner_id=$1 AND a.id=$2 ORDER BY t.started_at DESC,t.id DESC LIMIT 1",
          [this.ownerId, applicationId],
        )
      )[0];
      if (
        !["UNKNOWN", "NEEDS_REVIEW"].includes(String(row?.state)) ||
        row?.attempt_state !== "UNKNOWN"
      )
        throw new DomainError("STATE_INVALID", "Only an unknown attempt may be reconciled.");
      assertTransition(row.state as "UNKNOWN" | "NEEDS_REVIEW", "RECONCILING");
      const next = evidence ? "CONFIRMED" : "NEEDS_REVIEW";
      assertTransition("RECONCILING", next);
      if (evidence) {
        const snapshot = JSON.parse(String(row.snapshot)) as { jobId: string };
        const content = packetContentSchema.parse(JSON.parse(String(row.content)));
        const receiptUrl = new URL(evidence.receiptUrl);
        if (
          digest(snapshot) !== row.sha256 ||
          evidence.jobId !== snapshot.jobId ||
          evidence.jobId !== content.job.id ||
          evidence.emailHash !== digestEmail(content.cv.identity.email) ||
          receiptUrl.protocol !== "http:" ||
          receiptUrl.hostname !== "127.0.0.1" ||
          receiptUrl.pathname !== `/receipts/${evidence.recordId}`
        )
          throw new DomainError("RECEIPT_UNCORRELATED", "Recovered receipt differs from intent.");
        await tx.query(
          "INSERT INTO receipts(id,owner_id,application_id,attempt_id,evidence,sha256,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            this.ownerId,
            applicationId,
            String(row.attempt_id),
            JSON.stringify(evidence),
            digest(evidence),
            this.now(),
          ],
        );
        await tx.query(
          "UPDATE attempts SET state='CONFIRMED',ended_at=$1 WHERE owner_id=$2 AND id=$3",
          [this.now(), this.ownerId, String(row.attempt_id)],
        );
      }
      const updated = await tx.query(
        "UPDATE applications SET state=$1,revision=revision+2,updated_at=$2 WHERE owner_id=$3 AND id=$4 AND state=$5 AND revision=$6 RETURNING revision",
        [next, this.now(), this.ownerId, applicationId, row.state ?? null, Number(row.revision)],
      );
      if (!updated[0])
        throw new DomainError("REVISION_STALE", "Application changed during reconciliation.");
      await this.audit(tx, applicationId, "submission.reconciled", Number(updated[0].revision), {
        outcome: evidence ? "confirmed" : "needs_review",
      });
      if (evidence)
        await tx.query(
          "UPDATE exceptions SET status='resolved',resolved_action='reconcile',resolved_at=$1,updated_at=$1 WHERE owner_id=$2 AND application_id=$3 AND blocker='needs_review' AND status<>'resolved'",
          [this.now(), this.ownerId, applicationId],
        );
      return evidence ? "confirmed" : "needs_review";
    });
  }

  async reconcileWithoutReceipt(task: Task): Promise<"needs_review"> {
    const outcome = await this.reconcileMockReceipt(task, null);
    if (outcome !== "needs_review") throw new Error("Receipt-free reconciliation was confirmed.");
    return outcome;
  }

  async reconcileReceipt(
    task: Task,
    evidenceInput: ReceiptEvidence | null,
  ): Promise<"confirmed" | "needs_review"> {
    if (!evidenceInput) return this.reconcileWithoutReceipt(task);
    const evidence = receiptEvidenceSchema.parse(evidenceInput);
    if (evidence.kind === "mock_ats") return this.reconcileMockReceipt(task, evidence);
    throw new DomainError(
      "ADAPTER_UNSUPPORTED",
      "Recruitee receipt reconciliation is introduced with email integration in P11.",
    );
  }
}

const digestEmail = (email: string) => createHash("sha256").update(email).digest("hex");
