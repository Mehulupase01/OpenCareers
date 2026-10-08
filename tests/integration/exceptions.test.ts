import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
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
        const item = (await exceptions.inbox()).find(
          (entry) => entry.question?.semanticKey === "salary.numeric",
        );
        expect(item).toBeDefined();
        const result = await exceptions.resolve(item!.id, {
          action: "resolve_answer",
          answer: 65000,
          factIds: [factId],
        });
        expect(result.exception.state).toBe("resolved");
        expect(result.requeued).toBe(1);
        expect((await exceptions.inbox()).some((e) => e.id === item!.id)).toBe(false);
        // Only the affected application moved, and the answer is now approved.
        const apps = await db.query("SELECT id,state FROM applications WHERE owner_id=$1", [owner]);
        expect(apps).toHaveLength(1);
        expect(String(apps[0]?.state)).toBe("PREPARING");
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
        const item = (await exceptions.inbox()).find(
          (e) => e.question?.semanticKey === "salary.numeric",
        );
        // A missing answer and missing supporting evidence are both refused by
        // request validation, before any database work happens.
        await expect(
          exceptions.resolve(item!.id, { action: "resolve_answer", factIds: [factId] }),
        ).rejects.toThrow(/approved answer/i);
        await expect(
          exceptions.resolve(item!.id, {
            action: "resolve_answer",
            answer: 65000,
            factIds: ["nope"],
          }),
        ).rejects.toThrow(/not part of this profile/i);
        await expect(
          exceptions.resolve(item!.id, { action: "open_session", note: "nope" }),
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
        const item = (await exceptions.inbox()).find(
          (e) => e.question?.semanticKey === "salary.numeric",
        );
        // A differently worded question gets no suggestion even though an answer
        // exists under the same key.
        expect(item?.suggestedAnswer).toBeNull();
      });

      it("skips and defers without inventing progress", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = (await exceptions.inbox()).find(
          (e) => e.question?.semanticKey === "salary.numeric",
        );
        await exceptions.resolve(item!.id, { action: "skip" });
        expect(
          String(
            (await db.query("SELECT state FROM applications WHERE owner_id=$1", [owner]))[0]?.state,
          ),
        ).toBe("SKIPPED");

        await db.query("UPDATE applications SET state='NEEDS_INPUT' WHERE owner_id=$1", [owner]);
        await repo.resolveQuestion(applicationId, "notice.period", "Notice period in months");
        const second = (await exceptions.inbox()).find(
          (e) => e.question?.semanticKey === "notice.period",
        );
        const deferred = await exceptions.resolve(second!.id, { action: "defer" });
        expect(deferred.exception.state).toBe("deferred");
        expect(deferred.requeued).toBe(0);
        expect(
          String(
            (await db.query("SELECT state FROM applications WHERE owner_id=$1", [owner]))[0]?.state,
          ),
        ).toBe("NEEDS_INPUT");
      });

      it("surfaces a parked application that has no exception row at all", async () => {
        await db.query("UPDATE exceptions SET status='resolved' WHERE owner_id=$1", [owner]);
        const inbox = await exceptions.inbox();
        const parked = inbox.find((entry) => entry.applicationId === applicationId);
        expect(parked).toMatchObject({ blocker: "needs_input", state: "open" });
        expect(parked?.question).toBeNull();
        expect(parked?.id).toMatch(/^parked:/);
      });

      it("keeps a tamper-evident record of every owner decision", async () => {
        await repo.resolveQuestion(applicationId, "salary.numeric", "Gross annual salary in EUR");
        const item = (await exceptions.inbox()).find(
          (e) => e.question?.semanticKey === "salary.numeric",
        );
        await exceptions.resolve(item!.id, { action: "defer", note: "waiting on a decision" });
        const history = await exceptions.history(item!.id);
        expect(history.map((entry) => entry.action)).toEqual(["record", "defer"]);
        expect(history.every((entry) => entry.intact)).toBe(true);
        // Altering a stored decision must be detectable on the next read.
        await db.query(
          "UPDATE exception_actions SET note='tampered' WHERE owner_id=$1 AND action='defer'",
          [owner],
        );
        expect((await exceptions.history(item!.id)).some((entry) => !entry.intact)).toBe(true);
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
