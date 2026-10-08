import { createHash, randomUUID } from "node:crypto";
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
  type JobInput,
  jobInputSchema,
} from "../../contracts/src/index.js";
import { CandidateRepository } from "./candidate-repository.js";
import type { Database, Row, SqlExecutor } from "./database.js";
import { HandoffRepository } from "./handoff-repository.js";
import { Repository } from "./repository.js";

/**
 * The actions offered for each blocker. Offering an action that cannot succeed is
 * worse than offering none, so the set is derived from the blocker rather than
 * stored or passed in by the caller.
 */
const ACTIONS: Record<ExceptionBlocker, ExceptionAction[]> = {
  answer_unknown: ["resolve_answer", "defer", "skip"],
  challenge_required: ["open_session", "defer", "skip"],
  needs_review: ["reconcile", "defer", "skip"],
  needs_input: ["resolve_answer", "defer", "skip"],
  unsupported_form: ["defer", "skip"],
  task_failed: ["retry", "defer", "skip"],
  account_blocked: ["defer", "skip"],
};

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

      // An application parked without a recorded exception still needs the owner,
      // so the inbox is a view over both sources rather than over one table.
      const parked = await tx.query(
        "SELECT a.id,a.state,a.created_at,a.updated_at,j.data AS job_data FROM applications a JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE a.owner_id=$1",
        [this.ownerId],
      );
      for (const row of parked) {
        const state = String(row.state);
        if (!PARKED.has(state)) continue;
        if (out.some((item) => item.applicationId === String(row.id))) continue;
        out.push(await this.presentParked(row, state));
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
    const blocker = await this.blockerFor(id);
    if (!ACTIONS[blocker].includes(input.action))
      throw new DomainError(
        "STATE_INVALID",
        `"${input.action}" is not supported for a ${blocker} blocker.`,
      );
    // Only now that the action is known to be permitted for this blocker may it
    // reach a path with a side effect such as minting a handoff token.
    const opened = input.action === "open_session" ? await this.openSession(id, input) : null;
    if (opened) return opened;
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = await this.reload(tx, id);
      if (row.status === "resolved")
        throw new DomainError("STATE_INVALID", "This exception is already resolved.");
      if (!ACTIONS[exceptionBlockerSchema.parse(row.blocker)].includes(input.action))
        throw new DomainError("STATE_INVALID", "The exception blocker changed.");
      const applicationId = String(row.application_id ?? "");
      if (!applicationId)
        throw new DomainError("STATE_INVALID", "This exception is not attached to an application.");

      if (input.action === "resolve_answer") await this.approveForBlock(tx, id, input);

      if (input.action === "skip")
        await tx.query(
          "UPDATE applications SET state='SKIPPED',updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state IN ('NEEDS_INPUT','CHALLENGE_REQUIRED','NEEDS_REVIEW','UNSUPPORTED','PAUSED','RETRY_WAIT')",
          [this.now(), this.ownerId, applicationId],
        );

      const requeued =
        input.action === "reconcile"
          ? await this.queueReconciliation(tx, applicationId)
          : input.action === "retry" || input.action === "resolve_answer"
            ? await this.requeue(tx, applicationId)
            : 0;

      await tx.query(
        "UPDATE exceptions SET status=$1,resolved_action=$2,note=$3,updated_at=$4 WHERE owner_id=$5 AND id=$6",
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
        ],
      );
      await this.append(tx, id, input.action, input.note ?? "");
      await this.audit(tx, applicationId, `exception.${input.action}`, Number(row.revision ?? 1), {
        exceptionId: id,
        blocker,
      });
      return {
        exception: await this.present(tx, await this.reload(tx, id)),
        requeued,
        handoff: null,
      };
    });
  }

  private async queueReconciliation(tx: SqlExecutor, applicationId: string): Promise<number> {
    const attempt = (
      await tx.query(
        "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 AND state='UNKNOWN' ORDER BY started_at DESC,id DESC LIMIT 1",
        [this.ownerId, applicationId],
      )
    )[0];
    const source = (
      await tx.query(
        "SELECT t.id,t.domain,t.payload FROM tasks t JOIN attempts a ON a.owner_id=t.owner_id AND a.application_id=t.application_id AND a.fence=t.fence WHERE t.owner_id=$1 AND t.application_id=$2 AND t.type='submit' AND a.state='UNKNOWN' ORDER BY a.started_at DESC,a.id DESC LIMIT 1",
        [this.ownerId, applicationId],
      )
    )[0];
    if (!attempt || !source)
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
      dedupeKey: `owner-reconcile:${attempt.id}:${randomUUID()}`,
      payload: JSON.parse(String(source.payload)),
      priority: 100,
    });
    return 1;
  }

  /**
   * A handoff is a separate one-time credential, so it is created in its own
   * transaction and the token is returned exactly once here.
   */
  /** Reads the blocker and refuses an unknown exception before any action runs. */
  private async blockerFor(id: string): Promise<ExceptionBlocker> {
    const row = (
      await this.db.query("SELECT blocker,status FROM exceptions WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        id,
      ])
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Exception was not found.");
    if (row.status === "resolved")
      throw new DomainError("STATE_INVALID", "This exception is already resolved.");
    return exceptionBlockerSchema.parse(String(row.blocker ?? "task_failed"));
  }

  private async openSession(id: string, input: ExceptionResolveInput): Promise<ExceptionResolved> {
    const row = (
      await this.db.query("SELECT * FROM exceptions WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        id,
      ])
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Exception was not found.");
    const applicationId = String(row.application_id ?? "");
    if (!applicationId)
      throw new DomainError("STATE_INVALID", "This exception is not attached to an application.");
    const preparation = (
      await this.db.query(
        "SELECT id FROM browser_preparations WHERE owner_id=$1 AND application_id=$2 AND status='challenge' ORDER BY created_at DESC LIMIT 1",
        [this.ownerId, applicationId],
      )
    )[0];
    if (!preparation)
      throw new DomainError(
        "CHALLENGE_REQUIRED",
        "No challenged browser preparation is available to resume. Rebuild the form first.",
      );
    const target = await this.db.query(
      "SELECT result FROM browser_preparations WHERE owner_id=$1 AND id=$2",
      [this.ownerId, String(preparation.id)],
    );
    const parsed = JSON.parse(String(target[0]?.result ?? "{}")) as {
      adapter?: { targetFingerprint?: string };
    };
    if (!parsed.adapter?.targetFingerprint)
      throw new DomainError("FORM_CHANGED", "The challenged preparation has no adapter binding.");
    const handoffs = new HandoffRepository(this.db, this.ownerId, this.clock);
    const created = await handoffs.create({
      applicationId,
      preparationId: String(preparation.id),
      adapterId: String((parsed.adapter as { id?: string }).id ?? ""),
      targetFingerprint: parsed.adapter.targetFingerprint,
    });
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await tx.query(
        "UPDATE exceptions SET status='resolved',resolved_action='open_session',note=$1,updated_at=$2 WHERE owner_id=$3 AND id=$4",
        [input.note ?? null, this.now(), this.ownerId, id],
      );
      await this.append(tx, id, "open_session", input.note ?? "");
      await this.audit(tx, applicationId, "exception.open_session", 1, { exceptionId: id });
    });
    return {
      exception: await this.get(id),
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
      await this.append(tx, id, "record", input.reason);
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
  ): Promise<void> {
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
    await new CandidateRepository(this.db, this.ownerId, this.clock).saveAnswerIn(tx, {
      semanticKey: String(block.semantic_key),
      meaning,
      answer: input.answer,
      validFrom: today,
      validUntil: new Date(this.clock().getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
      employerIds: [job.employerId],
      countries: country ? [country] : [],
      evidenceFactIds: input.factIds ?? [],
    });
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

  /** Requeues only the affected application, never the whole queue. */
  private async requeue(tx: SqlExecutor, applicationId: string): Promise<number> {
    const state = String(
      (
        await tx.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          applicationId,
        ])
      )[0]?.state ?? "",
    );
    if (!RESUMABLE.includes(state)) return 0;
    const ambiguous = await tx.query(
      "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 AND (state<>'BLOCKED_BEFORE_DISPATCH' OR dispatch_started_at IS NOT NULL) LIMIT 1",
      [this.ownerId, applicationId],
    );
    if (ambiguous.length)
      throw new DomainError(
        "DUPLICATE_SUSPECTED",
        "A prior final action must be reconciled before retrying preparation.",
      );
    const assessment = (
      await tx.query(
        "SELECT m.id FROM match_assessments m JOIN candidates c ON c.owner_id=m.owner_id AND c.active_profile_id=m.profile_id WHERE m.owner_id=$1 AND m.application_id=$2 ORDER BY m.created_at DESC,m.revision DESC LIMIT 1",
        [this.ownerId, applicationId],
      )
    )[0];
    if (!assessment) return 0;
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
    return 1;
  }

  private async append(
    tx: SqlExecutor,
    exceptionId: string,
    action: string,
    note: string,
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
      [
        this.ownerId,
        randomUUID(),
        exceptionId,
        action,
        note,
        seq,
        `owner:${this.ownerId}`,
        this.now(),
        digest,
      ],
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
      applicationId,
      job: await this.job(tx, applicationId),
      question: block
        ? {
            semanticKey: String(block.semantic_key),
            meaning: String(block.meaning),
            answered: Boolean(block.resolved_answer_id),
            resolvedAnswerId: block.resolved_answer_id ? String(block.resolved_answer_id) : null,
          }
        : null,
      suggestedAnswer: await this.suggestion(tx, block, applicationId),
      actions: ACTIONS[blocker],
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

  private async presentParked(row: Row, state: string): Promise<OwnerException> {
    const blocker = STATE_BLOCKER[state] ?? "needs_input";
    const job = jobInputSchema.parse(JSON.parse(String(row.job_data))) as JobInput;
    return ownerExceptionSchema.parse({
      id: `parked:${String(row.id)}:${state}`,
      blocker,
      code: state === "CHALLENGE_REQUIRED" ? "CHALLENGE_REQUIRED" : "ANSWER_UNKNOWN",
      reason: `The application is parked in ${state} and needs an owner decision.`,
      applicationId: String(row.id),
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        employerId: job.employerId,
        ...(job.countryCode ? { countryCode: job.countryCode } : {}),
      },
      question: null,
      suggestedAnswer: null,
      actions: ACTIONS[blocker],
      state: "open",
      createdAt: String(row.created_at ?? this.now()),
      updatedAt: String(row.updated_at ?? this.now()),
    });
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
