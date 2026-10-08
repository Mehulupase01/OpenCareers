import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import type { OwnerException } from "../../packages/contracts/src/exception.js";
import { DomainError } from "../../packages/contracts/src/index.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { ExceptionRepository } from "../../packages/persistence/src/exception-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { identity, policy } from "../helpers/candidate-fixtures.js";

/** Finds an inbox item or fails loudly, so the tests never assert on undefined. */
async function salaryItem(exceptions: ExceptionRepository): Promise<OwnerException> {
  const item = (await exceptions.inbox()).find(
    (entry) => entry.question?.semanticKey === "salary.numeric",
  );
  if (!item) throw new Error("Expected a salary exception in the inbox.");
  return item;
}

async function noticeItem(exceptions: ExceptionRepository): Promise<OwnerException> {
  const item = (await exceptions.inbox()).find(
    (entry) => entry.question?.semanticKey === "notice.period",
  );
  if (!item) throw new Error("Expected a notice exception in the inbox.");
  return item;
}

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} exception inbox`,
    () => {
      let db: Database;
      let dir: string;
      let owner: string;
      let repo: CandidateRepository;
      let exceptions: ExceptionRepository;
      let applicationId: string;
      let jobId: string;
      let factId: string;
      let assessmentId: string;
      let now: number;

      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-exceptions-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "exceptions.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `exceptions-${randomUUID()}`;
        now = Date.parse("2026-09-28T10:00:00Z");
        repo = new CandidateRepository(db, owner, () => new Date(now));
        exceptions = new ExceptionRepository(db, owner, () => new Date(now));
        await repo.initialize();
        const fact = await repo.saveFact(identity);
        factId = fact.id;

        const snapshot = await repo.snapshot();
        const profile = await repo.publishProfile(snapshot.revision);
        await repo.saveAuthorization(policy(profile.id));
        jobId = "req-inbox";
        await repo.putJob({
          id: jobId,
          employerId: "synthetic-employer",
          requisitionId: jobId,
          title: "Machine Learning Engineer",
          company: "Synthetic Employer B.V.",
          location: "Amsterdam",
          countryCode: "NL",
          url: "https://synthetic.example/req-inbox",
          source: "fixture",
          synthetic: true,
          description: "Synthetic vacancy for the exception inbox.",
        });
        applicationId = (await repo.createApplication(jobId, snapshot.candidateId)).id;
        assessmentId = randomUUID();
        await db.query(
          "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,application_id,revision,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,1,'{}',$6,$7)",
          [
            owner,
            assessmentId,
            jobId,
            profile.id,
            applicationId,
            "a".repeat(64),
            new Date(now).toISOString(),
          ],
        );
        await db.query("UPDATE applications SET state='NEEDS_INPUT' WHERE owner_id=$1 AND id=$2", [
          owner,
          applicationId,
        ]);
      });

      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });

      it("shows an unanswered question as an actionable inbox item", async () => {
        expect(
          await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR"),
        ).toBeNull();
        const inbox = await exceptions.inbox();
        const item = inbox.find((entry) => entry.question?.semanticKey === "salary.numeric");
        expect(item).toMatchObject({
          blocker: "answer_unknown",
          applicationId,
          state: "open",
          actions: ["resolve_answer", "defer", "skip"],
        });
        expect(item?.job).toMatchObject({
          title: "Machine Learning Engineer",
          company: "Synthetic Employer B.V.",
          countryCode: "NL",
        });
        expect(item?.question).toMatchObject({
          meaning: "Gross annual salary in EUR",
          answered: false,
          resolvedAnswerId: null,
        });
        // The system must never invent an answer to an unknown question.
        expect(item?.suggestedAnswer).toBeNull();
        expect(item?.reason).toContain("Gross annual salary in EUR");
      });

      it("resolves a question only with the owner's answer and requeues just that application", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = await salaryItem(exceptions);
        expect(item).toBeDefined();
        const result = await exceptions.resolve(item.id, {
          action: "resolve_answer",
          answer: 65000,
          factIds: [factId],
        });
        expect(result.exception.state).toBe("resolved");
        expect(result.requeued).toBe(1);
        expect((await exceptions.inbox()).some((e) => e.id === item.id)).toBe(false);
        // Only the affected application moved, and the answer is now approved.
        const apps = await db.query("SELECT id,state FROM applications WHERE owner_id=$1", [owner]);
        expect(apps).toHaveLength(1);
        expect(String(apps[0]?.state)).toBe("PREPARING");
        const task = (await db.query("SELECT payload FROM tasks WHERE owner_id=$1", [owner]))[0];
        expect(JSON.parse(String(task?.payload))).toMatchObject({
          assessmentId,
          refreshAnswers: true,
        });
        expect(
          await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR"),
        ).not.toBeNull();
        // A differently worded question is still unknown.
        expect(
          await repo.resolveQuestion(applicationId, "salary.numeric", "Net monthly salary in EUR"),
        ).toBeNull();
      });

      it("refuses to resolve without an answer and refuses an unsupported action", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = await salaryItem(exceptions);
        // A missing answer and missing supporting evidence are both refused by
        // request validation, before any database work happens.
        await expect(
          exceptions.resolve(item.id, { action: "resolve_answer", factIds: [factId] }),
        ).rejects.toThrow(/approved answer/i);
        await expect(
          exceptions.resolve(item.id, {
            action: "resolve_answer",
            answer: 65000,
            factIds: ["nope"],
          }),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        await expect(
          exceptions.resolve(item.id, { action: "open_session", note: "nope" }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
      });

      it("offers a suggestion only for an approved answer of the exact meaning", async () => {
        await repo.saveAnswer({
          semanticKey: "salary.numeric",
          meaning: "Gross annual salary in EUR",
          answer: 65000,
          validFrom: "2026-09-01",
          validUntil: "2026-10-01",
          employerIds: [],
          countries: ["NL"],
          evidenceFactIds: [factId],
        });
        await repo.resolveQuestion(applicationId, "salary.numeric", "Net monthly salary in EUR");
        const item = await salaryItem(exceptions);
        // A differently worded question gets no suggestion even though an answer
        // exists under the same key.
        expect(item?.suggestedAnswer).toBeNull();
      });

      it("refuses expired supporting facts without partially approving or requeueing", async () => {
        const expired = await repo.saveFact({
          ...identity,
          key: "expired-evidence",
          expiresOn: "2026-09-01",
        });
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = await salaryItem(exceptions);
        await expect(
          exceptions.resolve(item.id, {
            action: "resolve_answer",
            answer: 65000,
            factIds: [expired.id],
          }),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        expect((await exceptions.get(item.id)).state).toBe("open");
        expect(
          await db.query("SELECT id FROM approved_answers WHERE owner_id=$1", [owner]),
        ).toHaveLength(0);
        expect(await db.query("SELECT id FROM tasks WHERE owner_id=$1", [owner])).toHaveLength(0);
      });

      it("keeps approval revisions immutable and restricts exception answers to this employer", async () => {
        const original = await repo.saveAnswer({
          semanticKey: "salary.numeric",
          meaning: "Net monthly salary in EUR",
          answer: 4500,
          validFrom: "2026-09-01",
          validUntil: "2026-10-01",
          employerIds: [],
          countries: ["NL"],
          evidenceFactIds: [factId],
        });
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = await salaryItem(exceptions);
        await exceptions.resolve(item.id, {
          action: "resolve_answer",
          answer: 65000,
          factIds: [factId],
        });
        const rows = await db.query(
          "SELECT id,revision,data FROM approved_answers WHERE owner_id=$1 ORDER BY revision",
          [owner],
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]?.id).toBe(original.id);
        expect(rows[0]?.revision).toBe(1);
        expect(JSON.parse(String(rows[0]?.data)).answer).toBe(4500);
        expect(JSON.parse(String(rows[1]?.data))).toMatchObject({
          employerIds: ["synthetic-employer"],
          validUntil: "2026-10-28",
        });
        const otherJob = {
          id: "other-employer-job",
          employerId: "other-employer",
          requisitionId: "other-req",
          title: "Engineer",
          company: "Another Synthetic Employer",
          location: "Amsterdam",
          countryCode: "NL",
          url: "https://synthetic.example/other",
          source: "fixture",
          synthetic: true,
          description: "Synthetic vacancy",
        };
        await repo.putJob(otherJob);
        const otherApp = await repo.createApplication(
          otherJob.id,
          (await repo.snapshot()).candidateId,
        );
        expect(
          await repo.resolveQuestion(otherApp.id, "salary.numeric", "Gross annual salary in EUR"),
        ).toBeNull();
        const otherItem = (await exceptions.inbox()).find(
          (entry) => entry.applicationId === otherApp.id,
        );
        expect(otherItem?.suggestedAnswer).toBeNull();
      });

      it("excludes country-restricted answers when the vacancy country is unknown", async () => {
        await repo.saveAnswer({
          semanticKey: "salary.numeric",
          meaning: "Gross annual salary in EUR",
          answer: 65000,
          validFrom: "2026-09-01",
          validUntil: "2026-10-01",
          employerIds: [],
          countries: ["NL"],
          evidenceFactIds: [factId],
        });
        expect(
          await repo.scopedAnswers({ employerId: "synthetic-employer", asOf: "2026-09-28" }),
        ).toEqual([]);
      });

      it("leaves a missing-assessment answer visible for recovery without queueing an invalid task", async () => {
        await db.query("DELETE FROM match_assessments WHERE owner_id=$1", [owner]);
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = await salaryItem(exceptions);
        const result = await exceptions.resolve(item.id, {
          action: "resolve_answer",
          answer: 65000,
          factIds: [factId],
        });
        expect(result.requeued).toBe(0);
        expect(await db.query("SELECT id FROM tasks WHERE owner_id=$1", [owner])).toHaveLength(0);
        expect(
          (await exceptions.inbox()).some((entry) => entry.applicationId === applicationId),
        ).toBe(true);
      });

      it("skips and defers without inventing progress", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = await salaryItem(exceptions);
        await exceptions.resolve(item.id, { action: "skip" });
        expect(
          String(
            (await db.query("SELECT state FROM applications WHERE owner_id=$1", [owner]))[0]?.state,
          ),
        ).toBe("SKIPPED");

        await db.query("UPDATE applications SET state='NEEDS_INPUT' WHERE owner_id=$1", [owner]);
        await repo.resolveQuestion(applicationId, "notice.period", "Notice period in months");
        const second = await noticeItem(exceptions);
        const deferred = await exceptions.resolve(second.id, { action: "defer" });
        expect(deferred.exception.state).toBe("deferred");
        expect(deferred.requeued).toBe(0);
        expect(
          String(
            (await db.query("SELECT state FROM applications WHERE owner_id=$1", [owner]))[0]?.state,
          ),
        ).toBe("NEEDS_INPUT");
      });

      it("materializes a parked application once with a durable actionable identifier", async () => {
        await db.query("UPDATE exceptions SET status='resolved' WHERE owner_id=$1", [owner]);
        const inbox = await exceptions.inbox();
        const parked = inbox.find((entry) => entry.applicationId === applicationId);
        expect(parked).toMatchObject({ blocker: "needs_input", state: "open" });
        expect(parked?.question).toBeNull();
        if (!parked) throw new Error("Expected parked application blocker");
        expect(parked.id).toMatch(/^[a-f0-9-]{36}$/);
        expect(parked.actions).toEqual(["defer", "skip"]);
        expect(await exceptions.get(parked.id)).toEqual(parked);
        expect(
          (await exceptions.inbox()).find((entry) => entry.applicationId === applicationId)?.id,
        ).toBe(parked.id);
        expect((await exceptions.history(parked.id)).every((entry) => entry.intact)).toBe(true);
        await expect(
          exceptions.resolve(parked.id, {
            action: "resolve_answer",
            answer: "Invented",
            factIds: [factId],
          }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        await exceptions.resolve(parked.id, { action: "defer", note: "Awaiting profile review" });
        expect((await exceptions.get(parked.id)).state).toBe("deferred");
      });

      it("does not offer unavailable challenge, retry or reconciliation paths", async () => {
        for (const [state, blocker, hidden] of [
          ["CHALLENGE_REQUIRED", "challenge_required", "open_session"],
          ["NEEDS_REVIEW", "needs_review", "reconcile"],
        ] as const) {
          await db.query("UPDATE applications SET state=$1 WHERE owner_id=$2 AND id=$3", [
            state,
            owner,
            applicationId,
          ]);
          await db.query("UPDATE exceptions SET status='resolved' WHERE owner_id=$1", [owner]);
          const entry = (await exceptions.inbox()).find(
            (item) => item.applicationId === applicationId,
          );
          if (!entry) throw new Error("Expected synthetic blocker");
          expect(entry.blocker).toBe(blocker);
          expect(entry.actions).not.toContain(hidden);
          if (state === "NEEDS_REVIEW") {
            expect(entry.actions).toEqual(["defer"]);
            await expect(exceptions.resolve(entry.id, { action: "skip" })).rejects.toMatchObject({
              code: "STATE_INVALID",
            });
          }
        }
        await db.query("UPDATE applications SET state='NEEDS_INPUT' WHERE owner_id=$1 AND id=$2", [
          owner,
          applicationId,
        ]);
        await db.query("DELETE FROM match_assessments WHERE owner_id=$1", [owner]);
        const failed = await exceptions.record({
          applicationId,
          blocker: "task_failed",
          code: "CONFIG_INVALID",
          reason: "Synthetic missing assessment",
        });
        expect((await exceptions.get(failed)).actions).not.toContain("retry");
        await expect(exceptions.resolve(failed, { action: "retry" })).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
      });

      it("skipping retires stale work, advances the application revision and settles sibling blockers", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        await repo.resolveQuestion(applicationId, "notice.period", "Notice period in months");
        const item = await salaryItem(exceptions);
        await repo.enqueue({
          type: "prepare",
          applicationId,
          domain: "documents",
          dedupeKey: "stale-preparation",
          payload: { schemaVersion: 1, assessmentId },
        });
        const lease = await repo.claim("synthetic-worker", ["prepare"]);
        if (!lease) throw new Error("Expected synthetic lease");
        const before = (
          await db.query("SELECT revision FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            applicationId,
          ])
        )[0];
        await exceptions.resolve(item.id, { action: "skip" });
        const after = (
          await db.query("SELECT revision,state FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            applicationId,
          ])
        )[0];
        expect(after?.state).toBe("SKIPPED");
        expect(after?.revision).toBe(Number(before?.revision) + 1);
        await expect(repo.renew(lease)).rejects.toMatchObject({ code: "LEASE_STALE" });
        expect(await exceptions.inbox()).toEqual([]);
        const event = (
          await db.query(
            "SELECT actor,revision FROM audit_events WHERE owner_id=$1 AND action='exception.skip'",
            [owner],
          )
        )[0];
        expect(event).toMatchObject({ actor: `owner:${owner}`, revision: after?.revision });
      });

      it("keeps a tamper-evident record of every owner decision", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = await salaryItem(exceptions);
        await exceptions.resolve(item.id, { action: "defer", note: "waiting on a decision" });
        const history = await exceptions.history(item.id);
        expect(history.map((entry) => entry.action)).toEqual(["record", "defer"]);
        expect(history.every((entry) => entry.intact)).toBe(true);
        // Altering a stored decision must be detectable on the next read.
        await db.query(
          "UPDATE exception_actions SET note='tampered' WHERE owner_id=$1 AND action='defer'",
          [owner],
        );
        expect((await exceptions.history(item.id)).some((entry) => !entry.intact)).toBe(true);
      });

      it("keeps failed non-application tasks visible and deferrable without breaking the inbox", async () => {
        await repo.enqueue({
          type: "demo_probe",
          domain: "synthetic",
          dedupeKey: "failed-discovery",
        });
        const task = await repo.claim("worker", ["demo_probe"]);
        if (!task) throw new Error("Expected synthetic task lease");
        await repo.fail(task, new DomainError("CONFIG_INVALID", "Synthetic failure"));
        const item = (await exceptions.inbox()).find((entry) => entry.applicationId === null);
        if (!item) throw new Error("Expected task exception");
        expect(item).toMatchObject({ job: null, blocker: "task_failed", actions: ["defer"] });
        expect((await exceptions.resolve(item.id, { action: "defer" })).exception.state).toBe(
          "deferred",
        );
        expect((await exceptions.get(item.id)).job).toBeNull();
        await expect(exceptions.resolve(item.id, { action: "retry" })).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
      });

      it("does not reopen or resume an owner-skipped application when an equivalent answer is approved", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = await salaryItem(exceptions);
        await exceptions.resolve(item.id, { action: "skip" });
        await repo.saveAnswer({
          semanticKey: "salary.numeric",
          meaning: "Gross annual salary in EUR",
          answer: 65000,
          validFrom: "2026-09-28",
          validUntil: "2026-10-01",
          employerIds: ["synthetic-employer"],
          countries: ["NL"],
          evidenceFactIds: [factId],
        });
        expect((await exceptions.get(item.id)).state).toBe("resolved");
        expect(await exceptions.inbox()).toEqual([]);
        expect(
          (
            await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
              owner,
              applicationId,
            ])
          )[0]?.state,
        ).toBe("SKIPPED");
        expect(await db.query("SELECT id FROM tasks WHERE owner_id=$1", [owner])).toHaveLength(0);
      });

      it("uses the checked original intent for reconciliation after task-fence revocation and never offers skip", async () => {
        const at = new Date(now).toISOString();
        const packetId = randomUUID();
        const intentId = randomUUID();
        const authorization = (
          await db.query("SELECT id FROM authorizations WHERE owner_id=$1", [owner])
        )[0];
        await db.query(
          "INSERT INTO packets(owner_id,id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,'{}',$4,$5)",
          [owner, packetId, applicationId, "a".repeat(64), at],
        );
        const payload = {
          schemaVersion: 1 as const,
          packetId,
          preparationId: "original-preparation",
          expectedRevision: 1,
        };
        const task = await repo.enqueue({
          type: "submit",
          domain: "mock-ats",
          applicationId,
          dedupeKey: "original-submit",
          payload,
        });
        const snapshot = {
          applicationId,
          taskId: task.id,
          adapter: "mock-ats",
          fence: 1,
          packetId,
          preparationId: payload.preparationId,
        };
        await db.query(
          "INSERT INTO intents(owner_id,id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            owner,
            intentId,
            applicationId,
            packetId,
            String(authorization?.id),
            JSON.stringify(snapshot),
            createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
            at,
          ],
        );
        await db.query(
          "INSERT INTO attempts(owner_id,id,application_id,intent_id,fence,state,started_at) VALUES($1,$2,$3,$4,1,'UNKNOWN',$5)",
          [owner, randomUUID(), applicationId, intentId, at],
        );
        await db.query("UPDATE tasks SET state='cancelled',fence=2 WHERE owner_id=$1 AND id=$2", [
          owner,
          task.id,
        ]);
        await db.query("UPDATE applications SET state='NEEDS_REVIEW' WHERE owner_id=$1 AND id=$2", [
          owner,
          applicationId,
        ]);
        const item = (await exceptions.inbox()).find(
          (entry) => entry.applicationId === applicationId,
        );
        if (!item) throw new Error("Expected outcome-review exception");
        expect(item.actions).toEqual(["reconcile", "defer"]);
        expect((await exceptions.resolve(item.id, { action: "reconcile" })).requeued).toBe(1);
        expect((await exceptions.resolve(item.id, { action: "reconcile" })).requeued).toBe(0);
        const queued = (
          await db.query(
            "SELECT domain,payload FROM tasks WHERE owner_id=$1 AND type='reconcile'",
            [owner],
          )
        )[0];
        expect(queued?.domain).toBe("mock-ats");
        expect(JSON.parse(String(queued?.payload))).toEqual(payload);
        await expect(exceptions.resolve(item.id, { action: "skip" })).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        await db.query("UPDATE intents SET sha256=$1 WHERE owner_id=$2 AND id=$3", [
          "f".repeat(64),
          owner,
          intentId,
        ]);
        expect((await exceptions.get(item.id)).actions).toEqual(["defer"]);
        await expect(exceptions.resolve(item.id, { action: "reconcile" })).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
      });

      it("resumes every equivalent in-scope application once but waits for other unresolved questions", async () => {
        const addApplication = async (suffix: string, employerId: string, meaning: string) => {
          const id = `job-${suffix}`;
          await repo.putJob({
            id,
            employerId,
            requisitionId: suffix,
            title: "Synthetic role",
            company: "Synthetic company",
            location: "NL",
            countryCode: "NL",
            url: `https://synthetic.example/${suffix}`,
            source: "fixture",
            synthetic: true,
            description: "Synthetic vacancy",
          });
          const app = await repo.createApplication(id, (await repo.snapshot()).candidateId);
          await db.query(
            "UPDATE applications SET state='NEEDS_INPUT' WHERE owner_id=$1 AND id=$2",
            [owner, app.id],
          );
          await db.query(
            "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,application_id,revision,data,sha256,created_at) SELECT owner_id,$1,$2,profile_id,$3,1,'{}',sha256,created_at FROM match_assessments WHERE owner_id=$4 AND id=$5",
            [randomUUID(), id, app.id, owner, assessmentId],
          );
          await repo.resolveQuestion(app.id, "salary.numeric", meaning);
          return app.id;
        };
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const equivalent = await addApplication(
          "equivalent",
          "synthetic-employer",
          "Gross annual salary in EUR",
        );
        const incomplete = await addApplication(
          "incomplete",
          "synthetic-employer",
          "Gross annual salary in EUR",
        );
        await repo.resolveQuestion(incomplete, "notice.period", "Notice period in months");
        const otherEmployer = await addApplication(
          "other",
          "other-employer",
          "Gross annual salary in EUR",
        );
        const otherMeaning = await addApplication(
          "net",
          "synthetic-employer",
          "Net monthly salary in EUR",
        );
        const item = (await exceptions.inbox()).find(
          (entry) =>
            entry.applicationId === applicationId &&
            entry.question?.semanticKey === "salary.numeric",
        );
        if (!item) throw new Error("Expected the original application salary blocker");
        const result = await exceptions.resolve(item.id, {
          action: "resolve_answer",
          answer: 65000,
          factIds: [factId],
        });
        expect(result.requeued).toBe(2);
        const apps = await db.query("SELECT id,state FROM applications WHERE owner_id=$1", [owner]);
        for (const id of [applicationId, equivalent])
          expect(apps.find((app) => app.id === id)?.state).toBe("PREPARING");
        for (const id of [incomplete, otherEmployer, otherMeaning])
          expect(apps.find((app) => app.id === id)?.state).toBe("NEEDS_INPUT");
        expect(
          await db.query("SELECT id FROM tasks WHERE owner_id=$1 AND type='prepare'", [owner]),
        ).toHaveLength(2);
        await repo.saveAnswer({
          semanticKey: "salary.numeric",
          meaning: "Gross annual salary in EUR",
          answer: 65000,
          validFrom: "2026-09-28",
          validUntil: "2026-10-01",
          employerIds: ["synthetic-employer"],
          countries: ["NL"],
          evidenceFactIds: [factId],
        });
        expect(
          await db.query("SELECT id FROM tasks WHERE owner_id=$1 AND type='prepare'", [owner]),
        ).toHaveLength(2);
        await repo.saveAnswer({
          semanticKey: "notice.period",
          meaning: "Notice period in months",
          answer: 1,
          validFrom: "2026-09-28",
          validUntil: "2026-10-01",
          employerIds: ["synthetic-employer"],
          countries: ["NL"],
          evidenceFactIds: [factId],
        });
        expect(
          (
            await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
              owner,
              incomplete,
            ])
          )[0]?.state,
        ).toBe("PREPARING");
        expect(
          await db.query("SELECT id FROM tasks WHERE owner_id=$1 AND type='prepare'", [owner]),
        ).toHaveLength(3);
      });

      it("isolates the inbox by owner", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        expect((await exceptions.inbox()).length).toBeGreaterThan(0);
        const other = `other-${randomUUID()}`;
        await new Repository(db, other).initialize();
        expect(await new ExceptionRepository(db, other, () => new Date(now)).inbox()).toEqual([]);
      });
    },
  );
}

describe("exception inbox API", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  it("requires owner authentication and exposes the inbox and decision history", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "opencareers-exception-api-"));
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
    const db = await openSqlite(":memory:");
    cleanup.push(() => db.close());
    await migrate(db);
    const owner = "synthetic-owner";
    const repository = new Repository(db, owner);
    await repository.initialize();
    const app = await buildServer(
      {
        ...loadConfig({}),
        profile: "demo",
        dataDir,
        vaultKey: Buffer.alloc(32, 7).toString("base64"),
      },
      repository,
    );
    cleanup.push(() => app.close());
    const headers = { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4318" };

    expect((await app.inject({ url: "/v1/exceptions", headers })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/v1/exceptions/x/resolve", headers, payload: {} }))
        .statusCode,
    ).toBe(401);

    const login = await app.inject({ method: "POST", url: "/v1/session", headers, payload: {} });
    const auth = { ...headers, cookie: `opencareers=${login.cookies[0]?.value}` };
    expect(Array.isArray((await app.inject({ url: "/v1/exceptions", headers: auth })).json())).toBe(
      true,
    );
    expect((await app.inject({ url: "/v1/exceptions/missing", headers: auth })).statusCode).toBe(
      404,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/exceptions/missing/resolve",
          headers: auth,
          payload: { action: "defer" },
        })
      ).statusCode,
    ).toBe(404);
  });
});
