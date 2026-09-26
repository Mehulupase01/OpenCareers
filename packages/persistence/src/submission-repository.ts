import { createHash, randomUUID } from "node:crypto";
import { dryRunResultSchema } from "../../contracts/src/browser.js";
import { packetContentSchema, packetManifestSchema } from "../../contracts/src/documents.js";
import { DomainError, type Task } from "../../contracts/src/index.js";
import {
  type MockReceiptEvidence,
  mockReceiptEvidenceSchema,
} from "../../contracts/src/submission.js";
import { assertTransition } from "../../domain/src/state.js";
import { CandidateRepository } from "./candidate-repository.js";
import type { SqlExecutor } from "./database.js";
import { Repository } from "./repository.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface CommitHandle {
  intentId: string;
  attemptId: string;
  applicationId: string;
  packetId: string;
  preparationId: string;
  fence: number;
}

export class SubmissionRepository extends Repository {
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
      const app = (
        await tx.query(
          "SELECT state,revision,commit_fence,job_id FROM applications WHERE owner_id=$1 AND id=$2",
          [this.ownerId, applicationId],
        )
      )[0];
      if (app?.state !== "READY")
        throw new DomainError("STATE_INVALID", "Application is not ready for a final action.");
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
      const preparation = (
        await tx.query(
          "SELECT status,result,created_at FROM browser_preparations WHERE owner_id=$1 AND id=$2 AND application_id=$3 AND packet_id=$4",
          [this.ownerId, input.preparationId, applicationId, input.packetId],
        )
      )[0];
      if (preparation?.status !== "ready")
        throw new DomainError("FORM_CHANGED", "A ready browser preparation is required.");
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
      const prior = await tx.query(
        "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 LIMIT 1",
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
        jobId: manifest.jobId,
        packetId: manifest.id,
        packetArtifacts: manifest.artifacts.map((artifact) => ({
          kind: artifact.kind,
          sha256: artifact.sha256,
        })),
        preparationId: input.preparationId,
        formFingerprints: result.snapshots.map((item) => item.fingerprint),
        authorizationId: policy.id,
        authorizationRevision: policy.revision,
        profileId: manifest.profileId,
        fence: task.fence,
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
        packetId: string;
        preparationId: string;
        profileId: string;
        authorizationRevision: number;
        fence: number;
      };
      if (
        digest(snapshot) !== row.sha256 ||
        snapshot.packetId !== handle.packetId ||
        snapshot.preparationId !== handle.preparationId ||
        snapshot.fence !== handle.fence
      )
        throw new DomainError("FORM_CHANGED", "Commit intent binding changed.");
      const control = await this.readControl(tx);
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

  async recordDefinitiveMockRejection(task: Task, handle: CommitHandle): Promise<void> {
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
          reason: "MOCK_VALIDATION_REJECTED",
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
      if (row?.state !== "UNKNOWN" || row.attempt_state !== "UNKNOWN")
        throw new DomainError("STATE_INVALID", "Only an unknown attempt may be reconciled.");
      assertTransition("UNKNOWN", "RECONCILING");
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
        "UPDATE applications SET state=$1,revision=revision+2,updated_at=$2 WHERE owner_id=$3 AND id=$4 AND state='UNKNOWN' AND revision=$5 RETURNING revision",
        [next, this.now(), this.ownerId, applicationId, Number(row.revision)],
      );
      if (!updated[0])
        throw new DomainError("REVISION_STALE", "Application changed during reconciliation.");
      await this.audit(tx, applicationId, "submission.reconciled", Number(updated[0].revision), {
        outcome: evidence ? "confirmed" : "needs_review",
      });
      return evidence ? "confirmed" : "needs_review";
    });
  }
}

const digestEmail = (email: string) => createHash("sha256").update(email).digest("hex");
