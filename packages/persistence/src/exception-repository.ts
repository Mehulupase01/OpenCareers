import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { dryRunResultSchema } from "../../contracts/src/browser.js";
import {
  type ExceptionAction,
  type ExceptionBlocker,
  type ExceptionResolved,
  type ExceptionResolveInput,
  exceptionBlockerSchema,
  exceptionResolveInputSchema,
  type OwnerException,
  ownerExceptionSchema,
} from "../../contracts/src/exception.js";
import {
  DomainError,
  errorCodeSchema,
  idSchema,
  type JobInput,
  jobInputSchema,
} from "../../contracts/src/index.js";
import { CandidateRepository } from "./candidate-repository.js";
import type { Database, Row, SqlExecutor } from "./database.js";
import { HandoffRepository } from "./handoff-repository.js";
import { PreparationRecovery } from "./preparation-recovery.js";
import { Repository } from "./repository.js";

const STATE_BLOCKER: Record<string, ExceptionBlocker> = {
  CHALLENGE_REQUIRED: "challenge_required",
  NEEDS_REVIEW: "needs_review",
  NEEDS_INPUT: "needs_input",
  UNSUPPORTED: "unsupported_form",
};

const PARKED = new Set(Object.keys(STATE_BLOCKER));

const RESUMABLE = [
  "NEEDS_INPUT",
  "CHALLENGE_REQUIRED",
  "NEEDS_REVIEW",
  "UNSUPPORTED",
  "RETRY_WAIT",
  "PAUSED",
];

const appendDigest = (exceptionId: string, previous: string, entry: string) =>
  createHash("sha256").update(`${previous}\n${exceptionId}\n${entry}`).digest("hex");

const reconciliationIntentSchema = z.object({
  applicationId: idSchema,
  taskId: idSchema,
  adapter: z.string().min(1),
  fence: z.number().int().positive(),
  packetId: idSchema,
  preparationId: idSchema,
});
const reconciliationPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    packetId: idSchema,
    preparationId: idSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export class ExceptionRepository extends Repository {
  constructor(db: Database, ownerId: string, clock?: () => Date) {
    super(db, ownerId, clock);
  }

  async inbox(): Promise<OwnerException[]> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const rows = await tx.query(
        "SELECT * FROM exceptions WHERE owner_id=$1 AND status<>'resolved' ORDER BY created_at ASC,id ASC",
        [this.ownerId],
      );
      const out: OwnerException[] = [];
      for (const row of rows) out.push(await this.present(tx, row));

      // Materialize missing blockers under the owner lock so every shown ID is actionable.
      const parked = await tx.query(
        "SELECT a.id,a.state,a.revision,a.created_at,a.updated_at FROM applications a WHERE a.owner_id=$1",
        [this.ownerId],
      );
      for (const row of parked) {
        const state = String(row.state);
        if (!PARKED.has(state)) continue;
        if (out.some((item) => item.applicationId === String(row.id))) continue;
        const id = randomUUID();
        const blocker = STATE_BLOCKER[state] ?? "needs_input";
        const code =
          state === "CHALLENGE_REQUIRED"
            ? "CHALLENGE_REQUIRED"
            : state === "NEEDS_REVIEW"
              ? "COMMIT_UNKNOWN"
              : state === "UNSUPPORTED"
                ? "ADAPTER_UNSUPPORTED"
                : "ANSWER_UNKNOWN";
        await tx.query(
          "INSERT INTO exceptions(id,owner_id,application_id,code,blocker,reason,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'open',$7,$8)",
          [
            id,
            this.ownerId,
            String(row.id),
            code,
            blocker,
            `The application is parked in ${state} and needs an owner decision.`,
            String(row.created_at),
            String(row.updated_at),
          ],
        );
        await this.append(tx, id, "record", "Materialized parked application blocker.", "system");
        await this.audit(tx, String(row.id), "exception.materialized", Number(row.revision), {
          exceptionId: id,
          blocker,
        });
        out.push(await this.present(tx, await this.reload(tx, id)));
      }
      return out;
    });
  }

  async get(id: string): Promise<OwnerException> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM exceptions WHERE owner_id=$1 AND id=$2", [this.ownerId, id])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Exception was not found.");
      return this.present(tx, row);
    });
  }

  async resolve(id: string, raw: ExceptionResolveInput): Promise<ExceptionResolved> {
    const input = exceptionResolveInputSchema.parse(raw);
    const current = await this.get(id);
    const blocker = current.blocker;
    if (current.state === "resolved" || !current.actions.includes(input.action))
      throw new DomainError(
        "STATE_INVALID",
        `"${input.action}" is not supported for a ${blocker} blocker.`,
      );
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = await this.reload(tx, id);
      if (row.status === "resolved")
        throw new DomainError("STATE_INVALID", "This exception is already resolved.");
      if (!(await this.availableActions(tx, row)).includes(input.action))
        throw new DomainError("STATE_INVALID", "The exception blocker changed.");
      const applicationId = String(row.application_id ?? "");
      if (!applicationId && input.action !== "defer")
        throw new DomainError("STATE_INVALID", "This exception is not attached to an application.");
      if (input.action === "open_session") return this.openSessionIn(tx, row, input);

      const answered =
        input.action === "resolve_answer" ? await this.approveForBlock(tx, id, input) : 0;

      if (input.action === "skip") {
        await tx.query(
          "UPDATE applications SET state='SKIPPED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3",
          [this.now(), this.ownerId, applicationId],
        );
        await tx.query(
          "UPDATE tasks SET state='cancelled',lease_owner=NULL,lease_until=NULL,fence=fence+1,last_error='TASK_CANCELLED' WHERE owner_id=$1 AND application_id=$2 AND type<>'reconcile' AND state IN ('ready','retry_wait','leased')",
          [this.ownerId, applicationId],
        );
        await tx.query(
          "UPDATE handoff_sessions SET state='cancelled',generation=generation+1,lease_owner=NULL,lease_until=NULL,completed_at=$1 WHERE owner_id=$2 AND application_id=$3 AND state IN ('open','claimed','rebuilding')",
          [this.now(), this.ownerId, applicationId],
        );
        const siblings = await tx.query(
          "SELECT id FROM exceptions WHERE owner_id=$1 AND application_id=$2 AND id<>$3 AND status<>'resolved'",
          [this.ownerId, applicationId, id],
        );
        for (const sibling of siblings) {
          await tx.query(
            "UPDATE exceptions SET status='resolved',resolved_action='skip',note=$1,updated_at=$2,resolved_at=$2 WHERE owner_id=$3 AND id=$4",
            [input.note ?? null, this.now(), this.ownerId, String(sibling.id)],
          );
          await this.append(tx, String(sibling.id), "skip", input.note ?? "");
        }
      }

      const requeued =
        input.action === "reconcile"
          ? await this.queueReconciliation(tx, applicationId)
          : input.action === "retry"
            ? await new PreparationRecovery(this.db, this.ownerId, this.clock).resumeIn(
                tx,
                applicationId,
                true,
              )
            : answered;

      await tx.query(
        "UPDATE exceptions SET status=$1,resolved_action=$2,note=$3,updated_at=$4,resolved_at=$7 WHERE owner_id=$5 AND id=$6",
        [
          input.action === "defer"
            ? "deferred"
            : input.action === "reconcile"
              ? "open"
              : "resolved",
          input.action,
          input.note ?? null,
          this.now(),
          this.ownerId,
          id,
          input.action === "defer" || input.action === "reconcile" ? null : this.now(),
        ],
      );
      await this.append(tx, id, input.action, input.note ?? "");
      const application = (
        await tx.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          applicationId,
        ])
      )[0];
      await this.audit(
        tx,
        applicationId || id,
        `exception.${input.action}`,
        Number(application?.revision ?? 0),
        {
          exceptionId: id,
          blocker,
        },
        `owner:${this.ownerId}`,
      );
      return {
        exception: await this.present(tx, await this.reload(tx, id)),
        requeued,
        handoff: null,
      };
    });
  }

  async queueReconciliation(tx: SqlExecutor, applicationId: string): Promise<number> {
    const source = await this.reconciliationSource(tx, applicationId);
    if (!source)
      throw new DomainError(
        "STATE_INVALID",
        "Reconciliation needs an unknown attempt and its original target.",
      );
    const active = await tx.query(
      "SELECT id FROM tasks WHERE owner_id=$1 AND application_id=$2 AND type='reconcile' AND state IN ('ready','retry_wait','leased')",
      [this.ownerId, applicationId],
    );
    if (active.length) return 0;
    await this.enqueueIn(tx, {
      type: "reconcile",
      domain: String(source.domain),
      applicationId,
      dedupeKey: `owner-reconcile:${source.attemptId}:${randomUUID()}`,
      payload: source.payload,
      priority: 100,
    });
    return 1;
  }

  private async reconciliationSource(tx: SqlExecutor, applicationId: string) {
    const attempt = (
      await tx.query(
        "SELECT a.id,a.fence,i.snapshot,i.sha256 FROM attempts a JOIN intents i ON i.owner_id=a.owner_id AND i.id=a.intent_id AND i.application_id=a.application_id WHERE a.owner_id=$1 AND a.application_id=$2 AND a.state='UNKNOWN' ORDER BY a.started_at DESC,a.id DESC LIMIT 1",
        [this.ownerId, applicationId],
      )
    )[0];
    if (!attempt) return null;
    try {
      const rawSnapshot = JSON.parse(String(attempt.snapshot));
      const snapshot = reconciliationIntentSchema.parse(rawSnapshot);
      if (
        createHash("sha256").update(JSON.stringify(rawSnapshot)).digest("hex") !== attempt.sha256 ||
        snapshot.applicationId !== applicationId ||
        snapshot.fence !== Number(attempt.fence)
      )
        return null;
      // A restore revokes the task fence; its immutable intent still names the original target.
      const source = (
        await tx.query(
          "SELECT domain,payload FROM tasks WHERE owner_id=$1 AND id=$2 AND application_id=$3 AND type='submit'",
          [this.ownerId, snapshot.taskId, applicationId],
        )
      )[0];
      if (!source || source.domain !== snapshot.adapter) return null;
      const payload = reconciliationPayloadSchema.parse(JSON.parse(String(source.payload)));
      if (
        payload.packetId !== snapshot.packetId ||
        payload.preparationId !== snapshot.preparationId
      )
        return null;
      return { attemptId: String(attempt.id), domain: String(source.domain), payload };
    } catch {
      return null;
    }
  }

  private async openSessionIn(
    tx: SqlExecutor,
    row: Row,
    input: ExceptionResolveInput,
  ): Promise<ExceptionResolved> {
    const id = String(row.id);
    const applicationId = String(row.application_id ?? "");
    if (!applicationId)
      throw new DomainError("STATE_INVALID", "This exception is not attached to an application.");
    const preparation = (
      await tx.query(
        "SELECT id,result FROM browser_preparations WHERE owner_id=$1 AND application_id=$2 AND status='challenge' AND resolved_at IS NULL AND (expires_at IS NULL OR expires_at>$3) ORDER BY created_at DESC,id DESC LIMIT 1",
        [this.ownerId, applicationId, this.now()],
      )
    )[0];
    if (!preparation)
      throw new DomainError(
        "CHALLENGE_REQUIRED",
        "No challenged browser preparation is available to resume. Rebuild the form first.",
      );
    const parsed = dryRunResultSchema.parse(JSON.parse(String(preparation.result)));
    if (!parsed.adapter?.targetFingerprint)
      throw new DomainError("FORM_CHANGED", "The challenged preparation has no adapter binding.");
    const handoffs = new HandoffRepository(this.db, this.ownerId, this.clock);
    const created = await handoffs.createIn(tx, {
      applicationId,
      preparationId: String(preparation.id),
      adapterId: parsed.adapter.id,
      targetFingerprint: parsed.adapter.targetFingerprint,
    });
    await tx.query(
      "UPDATE exceptions SET status='resolved',resolved_action='open_session',note=$1,updated_at=$2,resolved_at=$2 WHERE owner_id=$3 AND id=$4",
      [input.note ?? null, this.now(), this.ownerId, id],
    );
    await this.append(tx, id, "open_session", input.note ?? "");
    const application = (
      await tx.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        applicationId,
      ])
    )[0];
    await this.audit(
      tx,
      applicationId,
      "exception.open_session",
      Number(application?.revision ?? 0),
      { exceptionId: id },
      `owner:${this.ownerId}`,
    );
    return {
      exception: await this.present(tx, await this.reload(tx, id)),
      requeued: 0,
      handoff: { sessionId: created.session.id, token: created.token },
    };
  }

  /** Records a structured blocker for an application the owner must act on. */
  async record(input: {
    applicationId: string;
    blocker: ExceptionBlocker;
    code: string;
    reason: string;
  }): Promise<string> {
    const blocker = exceptionBlockerSchema.parse(input.blocker);
    const code = errorCodeSchema.parse(input.code);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const existing = (
        await tx.query(
          "SELECT id FROM exceptions WHERE owner_id=$1 AND application_id=$2 AND blocker=$3 AND status<>'resolved'",
          [this.ownerId, input.applicationId, blocker],
        )
      )[0];
      if (existing) {
        await tx.query(
          "UPDATE exceptions SET code=$1,reason=$2,updated_at=$3 WHERE owner_id=$4 AND id=$5",
          [code, input.reason, this.now(), this.ownerId, String(existing.id)],
        );
        return String(existing.id);
      }
      const id = randomUUID();
      await tx.query(
        "INSERT INTO exceptions(id,owner_id,application_id,code,blocker,reason,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'open',$7,$7)",
        [id, this.ownerId, input.applicationId, code, blocker, input.reason, this.now()],
      );
      await this.append(tx, id, "record", input.reason, "system");
      return id;
    });
  }

  /**
   * Approval is written inside the caller's transaction, so it cannot deadlock
   * against a nested transaction and it cannot leave a half-approved answer if the
   * surrounding decision is rolled back.
   *
   * The same checks the ordinary owner answer path applies are applied here: an
   * exact meaning, a validity window, and evidence that is still usable at the
   * revision it was approved against. The system will not invent an answer and
   * will not approve an unsupported one.
   */
  private async approveForBlock(
    tx: SqlExecutor,
    exceptionId: string,
    input: ExceptionResolveInput,
  ): Promise<number> {
    const block = (
      await tx.query("SELECT * FROM question_blocks WHERE owner_id=$1 AND exception_id=$2", [
        this.ownerId,
        exceptionId,
      ])
    )[0];
    if (!block)
      throw new DomainError("STATE_INVALID", "This exception is not an unanswered question.");
    const meaning = input.meaning ?? String(block.meaning);
    if (meaning !== String(block.meaning))
      throw new DomainError(
        "ANSWER_UNKNOWN",
        "The resolved meaning must be the exact question that was asked.",
      );
    const today = this.now().slice(0, 10);
    if (input.answer === undefined)
      throw new DomainError("ANSWER_UNKNOWN", "Resolving a question requires the owner's answer.");
    const job = await this.job(tx, String(block.application_id));
    const country = String(block.country ?? "");
    const result = await new CandidateRepository(this.db, this.ownerId, this.clock).approveAnswerIn(
      tx,
      {
        semanticKey: String(block.semantic_key),
        meaning,
        answer: input.answer,
        validFrom: today,
        validUntil: new Date(this.clock().getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
        employerIds: [job.employerId],
        countries: country ? [country] : [],
        evidenceFactIds: input.factIds ?? [],
      },
    );
    return result.requeued;
  }
  /**
   * Rebuilds a form from the saved packet and the active policy.
   *
   * Reconciliation always comes first. If any attempt for this application may
   * have reached the employer, the rebuild is refused outright rather than being
   * offered as a way past the ambiguity, because rebuilding and then submitting is
   * precisely how a duplicate application happens.
   */
  async rebuild(
    applicationId: string,
  ): Promise<{ requeued: number; reconciliationRequired: boolean }> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT state,revision FROM applications WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          applicationId,
        ])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Application was not found.");
      const ambiguous = (
        await tx.query(
          "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 AND (state<>'BLOCKED_BEFORE_DISPATCH' OR dispatch_started_at IS NOT NULL) LIMIT 1",
          [this.ownerId, applicationId],
        )
      )[0];
      if (ambiguous)
        throw new DomainError(
          "DUPLICATE_SUSPECTED",
          "A prior final action requires reconciliation before this form is rebuilt.",
        );
      const state = String(row.state);
      if (!RESUMABLE.includes(state))
        throw new DomainError("STATE_INVALID", `A form in ${state} cannot be rebuilt.`);
      // The stale preparation is retired so nothing can reuse it, and the newest
      // challenged handoff is closed so it cannot block the rebuild either.
      await tx.query(
        "UPDATE browser_preparations SET resolved_at=$1 WHERE owner_id=$2 AND application_id=$3 AND resolved_at IS NULL",
        [this.now(), this.ownerId, applicationId],
      );
      await tx.query(
        "UPDATE handoff_sessions SET state='cancelled',generation=generation+1,lease_owner=NULL,lease_until=NULL,completed_at=$1 WHERE owner_id=$2 AND application_id=$3 AND state IN ('open','claimed','rebuilding')",
        [this.now(), this.ownerId, applicationId],
      );
      const packet = (
        await tx.query(
          "SELECT p.id FROM packets p LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE p.owner_id=$1 AND p.application_id=$2 AND v.packet_id IS NULL ORDER BY p.created_at DESC,p.id DESC LIMIT 1",
          [this.ownerId, applicationId],
        )
      )[0];
      if (!packet)
        throw new DomainError("PROFILE_STALE", "Rebuilding requires a valid saved packet.");
      await tx.query(
        "UPDATE applications SET state='INSPECTING',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3",
        [this.now(), this.ownerId, applicationId],
      );
      await this.enqueueIn(tx, {
        type: "inspect",
        domain: "browser",
        applicationId,
        dedupeKey: `inspect:${applicationId}:rebuild:${Number(row.revision) + 1}`,
        payload: { schemaVersion: 1, packetId: String(packet.id) },
      });
      await this.audit(tx, applicationId, "form.rebuild_queued", Number(row.revision) + 1);
      return { requeued: 1, reconciliationRequired: false };
    });
  }

  private async append(
    tx: SqlExecutor,
    exceptionId: string,
    action: string,
    note: string,
    actor = `owner:${this.ownerId}`,
  ): Promise<void> {
    const previous = (
      await tx.query(
        "SELECT required_append,seq FROM exception_actions WHERE owner_id=$1 AND exception_id=$2 ORDER BY seq DESC LIMIT 1",
        [this.ownerId, exceptionId],
      )
    )[0];
    const seq = Number(previous?.seq ?? 0) + 1;
    const digest = appendDigest(
      exceptionId,
      String(previous?.required_append ?? ""),
      `${action}:${note}`,
    );
    await tx.query(
      "INSERT INTO exception_actions(owner_id,id,exception_id,action,note,seq,actor,occurred_at,required_append) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [this.ownerId, randomUUID(), exceptionId, action, note, seq, actor, this.now(), digest],
    );
  }

  /**
   * Re-verifies the decision chain. Each digest covers the previous one and the
   * entry text, so an edited or removed row is detectable. This is tamper
   * evidence for an accidental edit of a locally owned database, not a claim
   * that the store is tamper-proof.
   */
  async history(id: string): Promise<{ action: string; note: string; intact: boolean }[]> {
    const rows = await this.db.query(
      "SELECT action,note,required_append FROM exception_actions WHERE owner_id=$1 AND exception_id=$2 ORDER BY seq ASC",
      [this.ownerId, id],
    );
    const out: { action: string; note: string; intact: boolean }[] = [];
    let previous = "";
    for (const row of rows) {
      const action = String(row.action);
      const note = String(row.note ?? "");
      out.push({
        action,
        note,
        intact: appendDigest(id, previous, `${action}:${note}`) === String(row.required_append),
      });
      previous = String(row.required_append);
    }
    return out;
  }

  private async reload(tx: SqlExecutor, id: string): Promise<Row> {
    const row = (
      await tx.query("SELECT * FROM exceptions WHERE owner_id=$1 AND id=$2", [this.ownerId, id])
    )[0];
    if (!row) throw new DomainError("STORAGE_UNAVAILABLE", "Exception was not stored.");
    return row;
  }

  private async present(tx: SqlExecutor, row: Row): Promise<OwnerException> {
    const blocker = exceptionBlockerSchema.parse(String(row.blocker ?? "task_failed"));
    const applicationId = String(row.application_id ?? "");
    const block = (
      await tx.query(
        "SELECT semantic_key,meaning,resolved_answer_id FROM question_blocks WHERE owner_id=$1 AND exception_id=$2",
        [this.ownerId, String(row.id)],
      )
    )[0];
    return ownerExceptionSchema.parse({
      id: String(row.id),
      blocker,
      code: errorCodeSchema.parse(String(row.code)),
      reason: String(row.reason ?? String(row.code)),
      applicationId: applicationId || null,
      job: applicationId ? await this.job(tx, applicationId) : null,
      question: block
        ? {
            semanticKey: String(block.semantic_key),
            meaning: String(block.meaning),
            answered: Boolean(block.resolved_answer_id),
            resolvedAnswerId: block.resolved_answer_id ? String(block.resolved_answer_id) : null,
          }
        : null,
      suggestedAnswer: await this.suggestion(tx, block, applicationId),
      actions: await this.availableActions(tx, row),
      state:
        row.status === "deferred" ? "deferred" : row.status === "resolved" ? "resolved" : "open",
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at ?? row.created_at),
    });
  }

  /**
   * A suggestion is offered only when an approved answer already exists for this
   * exact meaning, employer, country and date. It is never generated here.
   */
  private async suggestion(tx: SqlExecutor, block: Row | undefined, applicationId: string) {
    if (!block || block.resolved_answer_id) return null;
    const job = await this.job(tx, applicationId);
    const answer = await new CandidateRepository(this.db, this.ownerId, this.clock).matchingAnswer(
      tx,
      String(block.semantic_key),
      String(block.meaning),
      job.employerId,
      String(block.country ?? ""),
    );
    if (!answer) return null;
    return {
      semanticKey: answer.semanticKey,
      answerId: answer.id,
      answer: answer.answer,
      approvedAt: answer.approvedAt,
    };
  }

  private async availableActions(tx: SqlExecutor, row: Row): Promise<ExceptionAction[]> {
    const applicationId = String(row.application_id ?? "");
    const blocker = exceptionBlockerSchema.parse(row.blocker);
    const app = (
      await tx.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        applicationId,
      ])
    )[0];
    if (!app || row.status === "resolved") return ["defer"];
    const potential =
      (
        await tx.query(
          "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 AND (state<>'BLOCKED_BEFORE_DISPATCH' OR dispatch_started_at IS NOT NULL) LIMIT 1",
          [this.ownerId, applicationId],
        )
      ).length > 0;
    const restored =
      (
        await tx.query(
          "SELECT application_id FROM restore_reviews WHERE owner_id=$1 AND application_id=$2 AND disposition<>'receipt' LIMIT 1",
          [this.ownerId, applicationId],
        )
      ).length > 0;
    const actions: ExceptionAction[] = [];
    if (!potential && !restored && ["answer_unknown", "needs_input"].includes(blocker)) {
      const block = (
        await tx.query(
          "SELECT semantic_key FROM question_blocks WHERE owner_id=$1 AND exception_id=$2 AND resolved_answer_id IS NULL",
          [this.ownerId, String(row.id)],
        )
      )[0];
      if (block) actions.push("resolve_answer");
    }
    if (blocker === "needs_review") {
      if (await this.reconciliationSource(tx, applicationId)) actions.push("reconcile");
    }
    if (
      !potential &&
      !restored &&
      blocker === "challenge_required" &&
      app.state === "CHALLENGE_REQUIRED"
    ) {
      const preparation = (
        await tx.query(
          "SELECT result FROM browser_preparations WHERE owner_id=$1 AND application_id=$2 AND status='challenge' AND resolved_at IS NULL AND (expires_at IS NULL OR expires_at>$3) ORDER BY created_at DESC,id DESC LIMIT 1",
          [this.ownerId, applicationId, this.now()],
        )
      )[0];
      let bound = false;
      try {
        bound = Boolean(
          preparation && dryRunResultSchema.parse(JSON.parse(String(preparation.result))).adapter,
        );
      } catch {
        bound = false;
      }
      const active = await tx.query(
        "SELECT id FROM handoff_sessions WHERE owner_id=$1 AND application_id=$2 AND state IN ('open','claimed','rebuilding') AND expires_at>$3 LIMIT 1",
        [this.ownerId, applicationId, this.now()],
      );
      if (bound && !active.length) actions.push("open_session");
    }
    if (
      !potential &&
      !restored &&
      blocker === "task_failed" &&
      RESUMABLE.includes(String(app.state)) &&
      app.state !== "NEEDS_REVIEW"
    ) {
      const assessment = await tx.query(
        "SELECT m.id FROM match_assessments m JOIN candidates c ON c.owner_id=m.owner_id AND c.active_profile_id=m.profile_id WHERE m.owner_id=$1 AND m.application_id=$2 LIMIT 1",
        [this.ownerId, applicationId],
      );
      const unanswered = await tx.query(
        "SELECT exception_id FROM question_blocks WHERE owner_id=$1 AND application_id=$2 AND resolved_answer_id IS NULL LIMIT 1",
        [this.ownerId, applicationId],
      );
      if (assessment.length && !unanswered.length) actions.push("retry");
    }
    actions.push("defer");
    if (
      !potential &&
      !restored &&
      blocker !== "needs_review" &&
      [
        ...RESUMABLE.filter((state) => state !== "NEEDS_REVIEW"),
        "DISCOVERED",
        "NORMALIZED",
        "ASSESSED",
        "ELIGIBLE",
        "PREPARING",
        "PREPARED",
        "INSPECTING",
        "READY",
      ].includes(String(app.state))
    )
      actions.push("skip");
    return actions;
  }

  private async job(tx: SqlExecutor, applicationId: string) {
    const row = (
      await tx.query(
        "SELECT j.data FROM applications a JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE a.owner_id=$1 AND a.id=$2",
        [this.ownerId, applicationId],
      )
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Application job was not found.");
    const job = jobInputSchema.parse(JSON.parse(String(row.data))) as JobInput;
    return {
      id: job.id,
      title: job.title,
      company: job.company,
      employerId: job.employerId,
      ...(job.countryCode ? { countryCode: job.countryCode } : {}),
    };
  }
}
