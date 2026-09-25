import { randomUUID } from "node:crypto";
import {
  type Application,
  type ApplicationState,
  applicationStateSchema,
  type Control,
  controlSchema,
  DomainError,
  type ErrorCode,
  type Job,
  type JobInput,
  jobInputSchema,
  type OperationsSummary,
  type Task,
  type TaskType,
  taskPayloadSchema,
  taskTypeSchema,
  VERSION,
} from "../../contracts/src/index.js";
import { assertTransition, retryDelay } from "../../domain/src/state.js";
import type { Row, SqlExecutor } from "./database.js";
import { jobIdentity } from "./job-identity.js";
import { OwnerScope } from "./owner-scope.js";

const initialControl: Control = {
  discoveryPaused: false,
  preparationPaused: false,
  submissionsPaused: true,
  stopped: false,
  restoreBlocked: false,
};
export const taskFromRow = (row: Row): Task => ({
  id: String(row.id),
  ownerId: String(row.owner_id),
  applicationId: row.application_id as string | null,
  type: taskTypeSchema.parse(row.type),
  domain: String(row.domain),
  state: row.state as Task["state"],
  payload: taskPayloadSchema.parse(JSON.parse(String(row.payload))),
  fence: Number(row.fence),
  attempts: Number(row.attempts),
  maxAttempts: Number(row.max_attempts),
  runAfter: String(row.run_after),
  leaseUntil: row.lease_until as string | null,
  leaseOwner: row.lease_owner as string | null,
  lastError: row.last_error as ErrorCode | null,
});
const applicationFromRow = (row: Row): Application => ({
  id: String(row.id),
  ownerId: String(row.owner_id),
  candidateId: String(row.candidate_id),
  jobId: String(row.job_id),
  state: applicationStateSchema.parse(row.state),
  revision: Number(row.revision),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export interface EnqueueInput {
  type: TaskType;
  dedupeKey: string;
  domain: string;
  applicationId?: string;
  payload?: Task["payload"];
  priority?: number;
  maxAttempts?: number;
  runAfter?: string;
}

export class Repository extends OwnerScope {
  async initialize(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query("INSERT INTO owners(id,created_at) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [
        this.ownerId,
        this.now(),
      ]);
      await tx.query(
        "INSERT INTO controls(owner_id,data) VALUES($1,$2) ON CONFLICT(owner_id) DO NOTHING",
        [this.ownerId, JSON.stringify(initialControl)],
      );
    });
  }

  protected async readControl(tx: SqlExecutor): Promise<Control> {
    const row = (await tx.query("SELECT data FROM controls WHERE owner_id=$1", [this.ownerId]))[0];
    if (!row) throw new DomainError("NOT_FOUND", "Owner controls missing.");
    return controlSchema.parse(JSON.parse(String(row.data)));
  }

  async getControl() {
    return this.readControl(this.db);
  }

  async setControl(
    patch: Partial<Omit<Control, "restoreBlocked">>,
    actor = "system",
  ): Promise<Control> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const control = controlSchema.parse({ ...(await this.readControl(tx)), ...patch });
      const rows = await tx.query(
        "UPDATE controls SET data=$1, revision=revision+1 WHERE owner_id=$2 RETURNING revision",
        [JSON.stringify(control), this.ownerId],
      );
      if (control.stopped || control.submissionsPaused) {
        const active = await tx.query(
          "SELECT * FROM tasks WHERE owner_id=$1 AND state='leased' AND type='submit'",
          [this.ownerId],
        );
        for (const row of active) await this.recoverTask(tx, taskFromRow(row), true);
      }
      await this.audit(
        tx,
        this.ownerId,
        control.stopped ? "control.stopped" : "control.changed",
        Number(rows[0]?.revision),
        {},
        actor,
      );
      return control;
    });
  }

  async putJob(input: JobInput): Promise<string> {
    const job = jobInputSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const rows = await tx.query(
        "INSERT INTO jobs(id,owner_id,employer_id,requisition_id,data,created_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(owner_id,employer_id,requisition_id) DO UPDATE SET data=excluded.data,last_seen_at=excluded.last_seen_at RETURNING id",
        [job.id, this.ownerId, job.employerId, job.requisitionId, JSON.stringify(job), this.now()],
      );
      return String(rows[0]?.id);
    });
  }

  async createApplication(
    jobId: string,
    candidateId: string,
    historical = false,
  ): Promise<Application> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const identity = await jobIdentity(tx, this.ownerId, jobId);
      jobId = identity.canonical;
      for (const member of identity.members) {
        const existing = (
          await tx.query(
            "SELECT * FROM applications WHERE owner_id=$1 AND candidate_id=$2 AND job_id=$3 AND state <> 'DUPLICATE'",
            [this.ownerId, candidateId, member],
          )
        )[0];
        if (existing) return applicationFromRow(existing);
      }
      const id = randomUUID();
      const inserted = await tx.query(
        "INSERT INTO applications(id,owner_id,candidate_id,job_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(owner_id,candidate_id,job_id) DO NOTHING RETURNING *",
        [
          id,
          this.ownerId,
          candidateId,
          jobId,
          historical ? "HISTORICAL_SUBMITTED" : "DISCOVERED",
          this.now(),
        ],
      );
      if (inserted[0]) {
        await this.audit(tx, id, "application.created", 0, {
          jobId,
          historical: historical ? 1 : 0,
        });
        return applicationFromRow(inserted[0]);
      }
      const row = (
        await tx.query(
          "SELECT * FROM applications WHERE owner_id=$1 AND candidate_id=$2 AND job_id=$3",
          [this.ownerId, candidateId, jobId],
        )
      )[0];
      if (!row) throw new DomainError("STORAGE_UNAVAILABLE", "Application creation failed.");
      return applicationFromRow(row);
    });
  }

  async transition(
    id: string,
    expectedRevision: number,
    state: ApplicationState,
  ): Promise<Application> {
    if (["IN_FLIGHT", "CONFIRMED", "INTENT_RECORDED"].includes(state)) {
      throw new DomainError(
        "STATE_INVALID",
        "This state requires the dedicated submission protocol.",
      );
    }
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM applications WHERE owner_id=$1 AND id=$2", [this.ownerId, id])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Application not found.");
      const app = applicationFromRow(row);
      if (app.revision !== expectedRevision)
        throw new DomainError("REVISION_STALE", "Application was changed by another operation.");
      assertTransition(app.state, state);
      const updated = await tx.query(
        "UPDATE applications SET state=$1,revision=revision+1,updated_at=$2 WHERE owner_id=$3 AND id=$4 AND revision=$5 RETURNING *",
        [state, this.now(), this.ownerId, id, expectedRevision],
      );
      if (!updated[0]) throw new DomainError("REVISION_STALE", "Application revision is stale.");
      await this.audit(tx, id, "application.transitioned", expectedRevision + 1, {
        from: app.state,
        to: state,
      });
      return applicationFromRow(updated[0]);
    });
  }

  protected async enqueueIn(tx: SqlExecutor, input: EnqueueInput): Promise<Task> {
    const type = taskTypeSchema.parse(input.type);
    const payload = taskPayloadSchema.parse(input.payload ?? { schemaVersion: 1 });
    const max = input.maxAttempts ?? 4;
    if (!Number.isInteger(max) || max < 1 || max > 20 || !input.dedupeKey || !input.domain)
      throw new DomainError("CONFIG_INVALID", "Invalid task retry budget, identity or domain.");
    const rows = await tx.query(
      "INSERT INTO tasks(id,owner_id,application_id,type,domain,state,dedupe_key,payload,priority,run_after,max_attempts,created_at) VALUES($1,$2,$3,$4,$5,'ready',$6,$7,$8,$9,$10,$11) ON CONFLICT(owner_id,dedupe_key) DO NOTHING RETURNING *",
      [
        randomUUID(),
        this.ownerId,
        input.applicationId ?? null,
        type,
        input.domain,
        input.dedupeKey,
        JSON.stringify(payload),
        input.priority ?? 0,
        input.runAfter ?? this.now(),
        max,
        this.now(),
      ],
    );
    const row =
      rows[0] ??
      (
        await tx.query("SELECT * FROM tasks WHERE owner_id=$1 AND dedupe_key=$2", [
          this.ownerId,
          input.dedupeKey,
        ])
      )[0];
    if (!row) throw new DomainError("STORAGE_UNAVAILABLE", "Task not persisted.");
    return taskFromRow(row);
  }

  async enqueue(input: EnqueueInput): Promise<Task> {
    return this.db.transaction((tx) => this.enqueueIn(tx, input));
  }

  protected async recoverTask(tx: SqlExecutor, task: Task, cancelled = false): Promise<void> {
    const app = task.applicationId
      ? (
          await tx.query("SELECT * FROM applications WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            task.applicationId,
          ])
        )[0]
      : undefined;
    if (
      task.type === "submit" &&
      app &&
      ["IN_FLIGHT", "UNKNOWN", "RECONCILING", "NEEDS_REVIEW"].includes(String(app.state))
    ) {
      if (app.state === "IN_FLIGHT") {
        await tx.query(
          "UPDATE applications SET state='UNKNOWN',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3",
          [this.now(), this.ownerId, task.applicationId],
        );
        await tx.query(
          "UPDATE attempts SET state='UNKNOWN',ended_at=$1 WHERE owner_id=$2 AND application_id=$3 AND state='IN_FLIGHT'",
          [this.now(), this.ownerId, task.applicationId],
        );
        await this.audit(tx, String(app.id), "application.uncertain", Number(app.revision) + 1);
      }
      await this.enqueueIn(tx, {
        type: "reconcile",
        dedupeKey: `reconcile:${app.id}:${task.id}`,
        applicationId: String(app.id),
        domain: task.domain,
        priority: 100,
      });
      await tx.query(
        "UPDATE tasks SET state='cancelled',lease_owner=NULL,lease_until=NULL,last_error='COMMIT_UNKNOWN' WHERE owner_id=$1 AND id=$2",
        [this.ownerId, task.id],
      );
    } else if (app?.state === "CONFIRMED" && task.type === "submit") {
      await tx.query(
        "UPDATE tasks SET state='completed',lease_owner=NULL,lease_until=NULL WHERE owner_id=$1 AND id=$2",
        [this.ownerId, task.id],
      );
    } else {
      const state = cancelled
        ? "cancelled"
        : task.attempts >= task.maxAttempts
          ? "dead"
          : "retry_wait";
      await tx.query(
        "UPDATE tasks SET state=$1,run_after=$2,lease_owner=NULL,lease_until=NULL,last_error=$3 WHERE owner_id=$4 AND id=$5",
        [state, this.now(), cancelled ? "TASK_CANCELLED" : "LEASE_STALE", this.ownerId, task.id],
      );
      if (state === "dead") await this.deadLetter(tx, task, "LEASE_STALE");
    }
    await this.audit(tx, task.id, "task.recovered", task.fence);
  }

  async claim(
    workerId: string,
    types: TaskType[],
    leaseMs = 30000,
    concurrency = 2,
  ): Promise<Task | null> {
    if (!types.length) return null;
    if (leaseMs < 1000 || leaseMs > 300000 || concurrency < 1 || concurrency > 20)
      throw new DomainError("CONFIG_INVALID", "Invalid worker limits.");
    for (const type of types) taskTypeSchema.parse(type);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const expired = await tx.query(
        "SELECT * FROM tasks WHERE owner_id=$1 AND state='leased' AND lease_until <= $2",
        [this.ownerId, this.now()],
      );
      for (const row of expired) await this.recoverTask(tx, taskFromRow(row));
      const control = await this.readControl(tx);
      const allowed = types.filter(
        (type) =>
          !control.stopped &&
          !(type === "submit" && (control.submissionsPaused || control.restoreBlocked)) &&
          !(type === "discover" && control.discoveryPaused) &&
          !(["assess", "prepare", "inspect"].includes(type) && control.preparationPaused),
      );
      if (!allowed.length) return null;
      const active = await tx.query("SELECT id FROM tasks WHERE owner_id=$1 AND state='leased'", [
        this.ownerId,
      ]);
      if (active.length >= concurrency) return null;
      const placeholders = allowed.map((_, i) => `$${i + 3}`).join(",");
      const rows = await tx.query(
        `SELECT t.* FROM tasks t WHERE t.owner_id=$1 AND t.state IN ('ready','retry_wait') AND t.run_after <= $2 AND t.type IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM tasks a WHERE a.owner_id=t.owner_id AND a.state='leased' AND (a.domain=t.domain OR (a.application_id IS NOT NULL AND a.application_id=t.application_id))) AND NOT (t.type='submit' AND EXISTS (SELECT 1 FROM applications a WHERE a.owner_id=t.owner_id AND a.id=t.application_id AND a.state IN ('IN_FLIGHT','UNKNOWN','RECONCILING','NEEDS_REVIEW','CONFIRMED','HISTORICAL_SUBMITTED','CLOSED','SKIPPED','DUPLICATE'))) ORDER BY t.priority DESC,t.created_at,t.id LIMIT 1${tx.dialect === "postgres" ? " FOR UPDATE OF t SKIP LOCKED" : ""}`,
        [this.ownerId, this.now(), ...allowed],
      );
      if (!rows[0]) return null;
      const task = taskFromRow(rows[0]);
      const fenceRows = await tx.query(
        "UPDATE owners SET next_fence=next_fence+1 WHERE id=$1 RETURNING next_fence",
        [this.ownerId],
      );
      const fence = Number(fenceRows[0]?.next_fence);
      const until = new Date(this.clock().getTime() + leaseMs).toISOString();
      const updated = await tx.query(
        "UPDATE tasks SET state='leased',fence=$1,attempts=attempts+1,lease_owner=$2,lease_until=$3 WHERE owner_id=$4 AND id=$5 RETURNING *",
        [fence, workerId, until, this.ownerId, task.id],
      );
      if (task.type === "submit" && task.applicationId)
        await tx.query("UPDATE applications SET commit_fence=$1 WHERE owner_id=$2 AND id=$3", [
          fence,
          this.ownerId,
          task.applicationId,
        ]);
      await this.audit(tx, task.id, "task.claimed", fence);
      return updated[0] ? taskFromRow(updated[0]) : null;
    });
  }

  private async validLease(tx: SqlExecutor, task: Task): Promise<Task> {
    const rows = await tx.query(
      "SELECT * FROM tasks WHERE owner_id=$1 AND id=$2 AND state='leased' AND fence=$3 AND lease_owner=$4 AND lease_until > $5",
      [this.ownerId, task.id, task.fence, task.leaseOwner, this.now()],
    );
    if (!rows[0]) throw new DomainError("LEASE_STALE", "Worker lease expired or was revoked.");
    return taskFromRow(rows[0]);
  }

  async renew(task: Task, leaseMs = 30000): Promise<void> {
    if (leaseMs < 1000 || leaseMs > 300000)
      throw new DomainError("CONFIG_INVALID", "Invalid lease duration.");
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const stored = await this.validLease(tx, task);
      const control = await this.readControl(tx);
      if (
        control.stopped ||
        (stored.type === "submit" && (control.submissionsPaused || control.restoreBlocked))
      )
        throw new DomainError("LEASE_STALE", "Execution paused.");
      await tx.query("UPDATE tasks SET lease_until=$1 WHERE owner_id=$2 AND id=$3", [
        new Date(this.clock().getTime() + leaseMs).toISOString(),
        this.ownerId,
        task.id,
      ]);
    });
  }

  async complete(task: Task): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const stored = await this.validLease(tx, task);
      if (stored.type === "submit") {
        const application = (
          await tx.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            stored.applicationId,
          ])
        )[0];
        if (
          !application ||
          !["CONFIRMED", "DEFINITIVE_FAILURE"].includes(String(application.state))
        )
          throw new DomainError(
            "STATE_INVALID",
            "Submission outcome must be resolved before acknowledgement.",
          );
      }
      await tx.query(
        "UPDATE tasks SET state='completed',lease_until=NULL,lease_owner=NULL WHERE owner_id=$1 AND id=$2",
        [this.ownerId, task.id],
      );
      await this.audit(tx, task.id, "task.completed", task.fence);
    });
  }

  async cancelTask(id: string, actor = "system"): Promise<Task> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const rows = await tx.query("SELECT * FROM tasks WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        id,
      ]);
      if (!rows[0]) throw new DomainError("NOT_FOUND", "Task not found.");
      const task = taskFromRow(rows[0]);
      if (["completed", "cancelled", "dead"].includes(task.state)) return task;
      if (task.type === "reconcile")
        throw new DomainError(
          "STATE_INVALID",
          "Uncertain outcomes must retain reconciliation work.",
        );
      await this.recoverTask(tx, task, true);
      await this.audit(tx, task.id, "task.cancelled", task.fence, {}, actor);
      const updated = await tx.query("SELECT * FROM tasks WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        id,
      ]);
      if (!updated[0]) throw new DomainError("STORAGE_UNAVAILABLE", "Cancelled task missing.");
      return taskFromRow(updated[0]);
    });
  }

  private async deadLetter(tx: SqlExecutor, task: Task, code: ErrorCode) {
    await tx.query(
      "INSERT INTO exceptions(id,owner_id,application_id,task_id,code,status,created_at) VALUES($1,$2,$3,$4,$5,'open',$6)",
      [randomUUID(), this.ownerId, task.applicationId, task.id, code, this.now()],
    );
  }

  async fail(task: Task, error: DomainError, random: () => number = Math.random): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const stored = await this.validLease(tx, task);
      if (stored.type === "submit") {
        const application = (
          await tx.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            stored.applicationId,
          ])
        )[0];
        if (
          application &&
          ["IN_FLIGHT", "UNKNOWN", "RECONCILING", "NEEDS_REVIEW", "CONFIRMED"].includes(
            String(application.state),
          )
        ) {
          await this.recoverTask(tx, stored);
          return;
        }
      }
      const retry = error.retryable && stored.attempts < stored.maxAttempts;
      await tx.query(
        "UPDATE tasks SET state=$1,run_after=$2,lease_until=NULL,lease_owner=NULL,last_error=$3 WHERE owner_id=$4 AND id=$5",
        [
          retry ? "retry_wait" : "dead",
          new Date(this.clock().getTime() + retryDelay(stored.attempts, random)).toISOString(),
          error.code,
          this.ownerId,
          task.id,
        ],
      );
      if (!retry) await this.deadLetter(tx, stored, error.code);
      await this.audit(tx, task.id, retry ? "task.retry_wait" : "task.dead", task.fence, {
        code: error.code,
      });
    });
  }

  async heartbeat(workerId: string, kind: string): Promise<void> {
    await this.db.query(
      "INSERT INTO workers(id,owner_id,kind,last_seen_at,version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,id) DO UPDATE SET last_seen_at=excluded.last_seen_at,version=excluded.version,kind=excluded.kind",
      [workerId, this.ownerId, kind, this.now(), VERSION],
    );
  }

  async consumeEvents(
    consumer: string,
    handler: (event: Row, tx: SqlExecutor) => Promise<void>,
    limit = 100,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const events = await tx.query(
        "SELECT a.* FROM audit_events a JOIN outbox o ON o.id=a.id WHERE a.owner_id=$1 AND o.available_at <= $2 AND NOT EXISTS (SELECT 1 FROM event_deliveries d WHERE d.event_id=a.id AND d.consumer=$3) ORDER BY a.occurred_at,a.id LIMIT $4",
        [this.ownerId, this.now(), consumer, limit],
      );
      for (const event of events) {
        await handler(event, tx);
        await tx.query(
          "INSERT INTO event_deliveries(event_id,consumer,delivered_at) VALUES($1,$2,$3)",
          [String(event.id), consumer, this.now()],
        );
      }
      return events.length;
    });
  }

  async summary(profile: OperationsSummary["profile"]): Promise<OperationsSummary> {
    return this.db.transaction(async (tx) => {
      const jobs = (
        await tx.query(
          "SELECT * FROM jobs WHERE owner_id=$1 ORDER BY last_seen_at DESC LIMIT 100",
          [this.ownerId],
        )
      ).map(
        (r): Job => ({
          ...jobInputSchema.parse(JSON.parse(String(r.data))),
          id: String(r.id),
          ownerId: this.ownerId,
          createdAt: String(r.created_at),
          lastSeenAt: String(r.last_seen_at),
        }),
      );
      const apps = await tx.query(
        "SELECT * FROM applications WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
        [this.ownerId],
      );
      const tasks = await tx.query(
        "SELECT * FROM tasks WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
        [this.ownerId],
      );
      const count = async (table: string, clause = "") =>
        Number(
          (
            await tx.query(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=$1 ${clause}`, [
              this.ownerId,
            ])
          )[0]?.count ?? 0,
        );
      const workers = await tx.query(
        "SELECT * FROM workers WHERE owner_id=$1 ORDER BY last_seen_at DESC",
        [this.ownerId],
      );
      return {
        version: VERSION,
        profile,
        control: await this.readControl(tx),
        asOf: this.now(),
        jobs,
        applications: apps.map(applicationFromRow),
        tasks: tasks.map(taskFromRow),
        counts: {
          jobs: await count("jobs"),
          applications: await count("applications"),
          confirmed: await count("applications", "AND state='CONFIRMED'"),
          prepared: await count("applications", "AND state IN ('PREPARED','INSPECTING','READY')"),
          unknown: await count(
            "applications",
            "AND state IN ('UNKNOWN','RECONCILING','NEEDS_REVIEW')",
          ),
          exceptions: await count("exceptions", "AND status='open'"),
          pendingTasks: await count("tasks", "AND state IN ('ready','retry_wait','leased')"),
        },
        workers: workers.map((r) => ({
          id: String(r.id),
          kind: String(r.kind),
          lastSeenAt: String(r.last_seen_at),
          version: String(r.version),
        })),
      };
    });
  }
}
