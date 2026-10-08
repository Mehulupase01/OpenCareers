import { randomUUID } from "node:crypto";
import type { SqlExecutor } from "./database.js";
import { Repository } from "./repository.js";

export class PreparationRecovery extends Repository {
  async resumeIn(tx: SqlExecutor, applicationId: string, allowRetry = false): Promise<number> {
    await this.lockOwner(tx);
    if ((await this.readControl(tx)).restoreBlocked) return 0;
    const app = (
      await tx.query("SELECT state,revision FROM applications WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        applicationId,
      ])
    )[0];
    const states = allowRetry
      ? ["NEEDS_INPUT", "CHALLENGE_REQUIRED", "UNSUPPORTED", "RETRY_WAIT", "PAUSED"]
      : ["NEEDS_INPUT"];
    if (!app || !states.includes(String(app.state))) return 0;
    const blocked = await tx.query(
      "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 AND (state<>'BLOCKED_BEFORE_DISPATCH' OR dispatch_started_at IS NOT NULL) UNION ALL SELECT application_id AS id FROM restore_reviews WHERE owner_id=$1 AND application_id=$2 AND disposition<>'receipt' UNION ALL SELECT exception_id AS id FROM question_blocks WHERE owner_id=$1 AND application_id=$2 AND resolved_answer_id IS NULL",
      [this.ownerId, applicationId],
    );
    if (blocked.length) return 0;
    const assessment = (
      await tx.query(
        "SELECT m.id FROM match_assessments m JOIN candidates c ON c.owner_id=m.owner_id AND c.active_profile_id=m.profile_id WHERE m.owner_id=$1 AND m.application_id=$2 ORDER BY m.created_at DESC,m.revision DESC,m.id DESC LIMIT 1",
        [this.ownerId, applicationId],
      )
    )[0];
    if (!assessment) return 0;
    await tx.query(
      "UPDATE tasks SET state='cancelled',lease_owner=NULL,lease_until=NULL,fence=fence+1,last_error='TASK_CANCELLED' WHERE owner_id=$1 AND application_id=$2 AND type IN ('prepare','inspect') AND state IN ('ready','retry_wait','leased')",
      [this.ownerId, applicationId],
    );
    await tx.query(
      "UPDATE browser_preparations SET resolved_at=$1 WHERE owner_id=$2 AND application_id=$3 AND resolved_at IS NULL",
      [this.now(), this.ownerId, applicationId],
    );
    await tx.query(
      "UPDATE handoff_sessions SET state='cancelled',generation=generation+1,lease_owner=NULL,lease_until=NULL,completed_at=$1 WHERE owner_id=$2 AND application_id=$3 AND state IN ('open','claimed','rebuilding')",
      [this.now(), this.ownerId, applicationId],
    );
    await tx.query(
      "UPDATE applications SET state='PREPARING',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3",
      [this.now(), this.ownerId, applicationId],
    );
    await this.enqueueIn(tx, {
      type: "prepare",
      domain: "documents",
      applicationId,
      dedupeKey: `prepare:${applicationId}:owner:${randomUUID()}`,
      payload: { schemaVersion: 1, assessmentId: String(assessment.id), refreshAnswers: true },
    });
    await this.audit(
      tx,
      applicationId,
      "preparation.owner_resumed",
      Number(app.revision) + 1,
      { assessmentId: String(assessment.id) },
      `owner:${this.ownerId}`,
    );
    return 1;
  }
}
