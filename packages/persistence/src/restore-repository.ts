import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";
import { receiptEvidenceSchema } from "../../contracts/src/submission.js";
import type { SqlExecutor } from "./database.js";
import { Repository } from "./repository.js";

export async function assertNoRestoreReplay(
  tx: SqlExecutor,
  ownerId: string,
  applicationId: string,
) {
  const blocked = await tx.query(
    "SELECT r.application_id FROM restore_reviews r JOIN restore_runs s ON s.owner_id=r.owner_id AND s.id=r.run_id WHERE r.owner_id=$1 AND r.application_id=$2 AND (r.disposition<>'receipt' OR s.state='open') LIMIT 1",
    [ownerId, applicationId],
  );
  if (blocked.length)
    throw new DomainError(
      "POLICY_REVOKED",
      "Restored application is quarantined against final-action replay.",
    );
}

const reviewSchema = z
  .object({
    disposition: z.enum(["quarantined", "receipt"]),
    receiptId: z.uuid().optional(),
    note: z.string().trim().min(1).max(2000),
  })
  .strict();

export class RestoreRepository extends Repository {
  private assertOwner(actor: string) {
    if (actor !== `owner:${this.ownerId}`)
      throw new DomainError("UNAUTHORIZED", "Restore review requires the owner.");
  }

  async status() {
    return {
      control: await this.getControl(),
      runs: await this.db.query(
        "SELECT * FROM restore_runs WHERE owner_id=$1 ORDER BY started_at DESC,id DESC",
        [this.ownerId],
      ),
      reviews: await this.db.query(
        "SELECT * FROM restore_reviews WHERE owner_id=$1 ORDER BY run_id,application_id",
        [this.ownerId],
      ),
    };
  }

  // Call on the restored database while every old/new worker and browser is offline.
  async block(snapshotSha256: string, actor = "system:restore") {
    if (!/^[a-f0-9]{64}$/.test(snapshotSha256))
      throw new DomainError("CONFIG_INVALID", "A restore snapshot checksum is required.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const active = (
        await tx.query("SELECT * FROM restore_runs WHERE owner_id=$1 AND state='open'", [
          this.ownerId,
        ])
      )[0];
      if (active) {
        if (active.snapshot_sha256 !== snapshotSha256)
          throw new DomainError("STATE_INVALID", "Another restore review is already open.");
        return String(active.id);
      }
      const id = randomUUID();
      await tx.query(
        "INSERT INTO restore_runs(owner_id,id,snapshot_sha256,state,started_at) VALUES($1,$2,$3,'open',$4)",
        [this.ownerId, id, snapshotSha256, this.now()],
      );
      const control = {
        ...(await this.readControl(tx)),
        restoreBlocked: true,
        discoveryPaused: true,
        preparationPaused: true,
        submissionsPaused: true,
      };
      await tx.query("UPDATE controls SET data=$1,revision=revision+1 WHERE owner_id=$2", [
        JSON.stringify(control),
        this.ownerId,
      ]);
      // Even a pre-intent snapshot can predate an actual dispatch on the old installation.
      await tx.query(
        "INSERT INTO restore_reviews(owner_id,run_id,application_id,disposition) SELECT owner_id,$1,id,'pending' FROM applications WHERE owner_id=$2",
        [id, this.ownerId],
      );
      await tx.query(
        "UPDATE applications SET revision=revision+1,commit_fence=commit_fence+1,updated_at=$1 WHERE owner_id=$2",
        [this.now(), this.ownerId],
      );
      await tx.query(
        "UPDATE applications SET state='UNKNOWN' WHERE owner_id=$1 AND state IN ('INTENT_RECORDED','IN_FLIGHT','RECONCILING')",
        [this.ownerId],
      );
      await tx.query(
        "UPDATE attempts SET state='UNKNOWN',ended_at=$1 WHERE owner_id=$2 AND state IN ('INTENT_RECORDED','IN_FLIGHT')",
        [this.now(), this.ownerId],
      );
      const originals = await tx.query(
        "SELECT DISTINCT t.* FROM tasks t JOIN attempts a ON a.owner_id=t.owner_id AND a.application_id=t.application_id AND a.fence=t.fence WHERE t.owner_id=$1 AND t.type='submit' AND a.state='UNKNOWN'",
        [this.ownerId],
      );
      await tx.query(
        "UPDATE tasks SET state='cancelled',lease_owner=NULL,lease_until=NULL,fence=fence+1,last_error='POLICY_REVOKED' WHERE owner_id=$1 AND type<>'reconcile' AND state IN ('ready','retry_wait','leased')",
        [this.ownerId],
      );
      // Reconciliation is read-only; revoke stale leases without losing the work.
      await tx.query(
        "UPDATE tasks SET state='ready',lease_owner=NULL,lease_until=NULL,fence=fence+1 WHERE owner_id=$1 AND type='reconcile' AND state='leased'",
        [this.ownerId],
      );
      await tx.query(
        "UPDATE handoff_sessions SET state='cancelled',generation=generation+1,lease_owner=NULL,lease_until=NULL,completed_at=$1 WHERE owner_id=$2 AND state IN ('open','claimed','rebuilding')",
        [this.now(), this.ownerId],
      );
      await tx.query(
        "UPDATE browser_preparations SET status='expired',resolved_at=$1 WHERE owner_id=$2 AND resolved_at IS NULL",
        [this.now(), this.ownerId],
      );
      await tx.query(
        "INSERT INTO packet_validity(owner_id,packet_id,invalidated_at,reason) SELECT owner_id,id,$1,'restore quarantine' FROM packets WHERE owner_id=$2 ON CONFLICT(owner_id,packet_id) DO NOTHING",
        [this.now(), this.ownerId],
      );
      for (const row of originals) {
        if (
          (
            await tx.query(
              "SELECT id FROM tasks WHERE owner_id=$1 AND application_id=$2 AND type='reconcile' AND state IN ('ready','retry_wait','leased') LIMIT 1",
              [this.ownerId, String(row.application_id)],
            )
          ).length
        )
          continue;
        await this.enqueueIn(tx, {
          type: "reconcile",
          domain: String(row.domain),
          applicationId: String(row.application_id),
          payload: JSON.parse(String(row.payload)),
          priority: 100,
          dedupeKey: `restore:${id}:${row.application_id}:${row.id}`,
        });
      }
      await this.audit(tx, id, "restore.blocked", 1, { snapshotSha256 }, actor);
      return id;
    });
  }

  private async validReceipt(tx: SqlExecutor, applicationId: string, receiptId: string) {
    const row = (
      await tx.query(
        "SELECT r.evidence,r.sha256,a.job_id,a.state,t.state AS attempt_state FROM receipts r JOIN applications a ON a.owner_id=r.owner_id AND a.id=r.application_id JOIN attempts t ON t.owner_id=r.owner_id AND t.id=r.attempt_id AND t.application_id=r.application_id WHERE r.owner_id=$1 AND r.application_id=$2 AND r.id=$3",
        [this.ownerId, applicationId, receiptId],
      )
    )[0];
    if (row?.state !== "CONFIRMED" || row.attempt_state !== "CONFIRMED")
      throw new DomainError("STATE_INVALID", "A correlated confirmed receipt is required.");
    let evidence: unknown;
    try {
      evidence = JSON.parse(String(row.evidence));
    } catch {
      throw new DomainError("STORAGE_UNAVAILABLE", "Restore receipt is corrupted.");
    }
    const parsed = receiptEvidenceSchema.safeParse(evidence);
    if (
      !parsed.success ||
      parsed.data.jobId !== row.job_id ||
      createHash("sha256").update(JSON.stringify(evidence)).digest("hex") !== row.sha256
    )
      throw new DomainError(
        "STORAGE_UNAVAILABLE",
        "Restore receipt identity or checksum is invalid.",
      );
  }

  async review(
    runId: string,
    applicationId: string,
    raw: z.input<typeof reviewSchema>,
    actor: string,
  ) {
    this.assertOwner(actor);
    const input = reviewSchema.parse(raw);
    if ((input.disposition === "receipt") !== Boolean(input.receiptId))
      throw new DomainError("CONFIG_INVALID", "Only receipt-backed reviews accept a receipt ID.");
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query(
          "SELECT r.disposition,s.state FROM restore_reviews r JOIN restore_runs s ON s.owner_id=r.owner_id AND s.id=r.run_id WHERE r.owner_id=$1 AND r.run_id=$2 AND r.application_id=$3",
          [this.ownerId, runId, applicationId],
        )
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Restore review not found.");
      if (
        row.disposition === "receipt" ||
        (row.state !== "open" && input.disposition !== "receipt")
      )
        throw new DomainError("STATE_INVALID", "A completed review cannot be weakened.");
      if (input.receiptId) await this.validReceipt(tx, applicationId, input.receiptId);
      await tx.query(
        "UPDATE restore_reviews SET disposition=$1,receipt_id=$2,note=$3,reviewed_at=$4 WHERE owner_id=$5 AND run_id=$6 AND application_id=$7",
        [
          input.disposition,
          input.receiptId ?? null,
          input.note,
          this.now(),
          this.ownerId,
          runId,
          applicationId,
        ],
      );
      await this.audit(
        tx,
        runId,
        "restore.application_reviewed",
        1,
        {
          applicationId,
          from: String(row.disposition),
          disposition: input.disposition,
          receiptId: input.receiptId ?? null,
        },
        actor,
      );
    });
  }

  async release(runId: string, actor: string, rawGap?: z.input<typeof restoreGapReviewSchema>) {
    this.assertOwner(actor);
    const gap = restoreGapReviewSchema.parse(rawGap);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const run = (
        await tx.query("SELECT state,started_at FROM restore_runs WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          runId,
        ])
      )[0];
      if (run?.state !== "open")
        throw new DomainError("STATE_INVALID", "No matching open restore review.");
      if (
        Date.parse(gap.from) > Date.parse(String(run.started_at)) ||
        Date.parse(gap.through) < Date.parse(String(run.started_at)) ||
        Date.parse(gap.through) > this.clock().getTime() ||
        Date.parse(gap.from) > Date.parse(gap.through)
      )
        throw new DomainError(
          "CONFIG_INVALID",
          "External-history review must cover the backup-to-restore gap without future evidence.",
        );
      const reviews = await tx.query(
        "SELECT application_id,disposition,receipt_id FROM restore_reviews WHERE owner_id=$1 AND run_id=$2",
        [this.ownerId, runId],
      );
      if (reviews.some((review) => review.disposition === "pending"))
        throw new DomainError(
          "STATE_INVALID",
          "Every restored application must be reconciled or quarantined.",
        );
      for (const review of reviews)
        if (review.disposition === "receipt")
          await this.validReceipt(tx, String(review.application_id), String(review.receipt_id));
      await tx.query(
        "UPDATE restore_runs SET state='completed',completed_at=$1,gap_evidence_sha256=$2,gap_from=$3,gap_through=$4 WHERE owner_id=$5 AND id=$6",
        [this.now(), gap.evidenceSha256, gap.from, gap.through, this.ownerId, runId],
      );
      const control = {
        ...(await this.readControl(tx)),
        restoreBlocked: false,
        submissionsPaused: true,
      };
      await tx.query("UPDATE controls SET data=$1,revision=revision+1 WHERE owner_id=$2", [
        JSON.stringify(control),
        this.ownerId,
      ]);
      await this.audit(
        tx,
        runId,
        "restore.released_with_quarantine",
        2,
        { gapEvidenceSha256: gap.evidenceSha256, gapFrom: gap.from, gapThrough: gap.through },
        actor,
      );
      return control;
    });
  }
}

export const restoreGapReviewSchema = z
  .object({
    externalHistoryReviewedAndImported: z.literal(true),
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    from: z.iso.datetime(),
    through: z.iso.datetime(),
  })
  .strict();
