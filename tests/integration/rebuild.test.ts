import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dryRunResultSchema } from "../../packages/contracts/src/browser.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { ExceptionRepository } from "../../packages/persistence/src/exception-repository.js";
import { HandoffRepository } from "../../packages/persistence/src/handoff-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

const minutes = (value: number) => value * 60_000;

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} safe form rebuild`,
    () => {
      let db: Database;
      let dir: string;
      let owner: string;
      let applicationId: string;
      let preparationId: string;
      let packetId: string;
      let jobId: string;
      let now: number;
      let repository: Repository;
      let exceptions: ExceptionRepository;
      let handoffs: HandoffRepository;

      const targetFingerprint = createHash("sha256")
        .update(JSON.stringify({ adapterId: "mock-ats" }))
        .digest("hex");

      const addPreparation = async (createdAt: string, status: "ready" | "challenge") => {
        preparationId = randomUUID();
        const snapshot = {
          url: `http://127.0.0.1:4320/jobs/${status}`,
          origin: "http://127.0.0.1:4320",
          jobId,
          step: 1,
          fields: [],
          fingerprint: "a".repeat(64),
          blocker: status === "challenge" ? ("challenge" as const) : ("none" as const),
        };
        const result = dryRunResultSchema.parse({
          adapter: { id: "mock-ats", version: "mock-ats-v1", targetFingerprint },
          packetId,
          applicationId,
          status,
          snapshots: [snapshot],
          plans: [{ fingerprint: snapshot.fingerprint, entries: [], unresolved: [] }],
          reports: [
            {
              snapshot,
              status,
              readBack: [],
              uploadStatus: "idle",
              issues:
                status === "challenge" ? ["Verification challenge requires owner action."] : [],
            },
          ],
          issues: status === "challenge" ? ["Verification challenge requires owner action."] : [],
          blockedFinalActions: 0,
          serverApplicationCount: 0,
          preparedAt: createdAt,
        });
        await db.query(
          "INSERT INTO browser_preparations(owner_id,id,application_id,packet_id,status,form_fingerprint,result,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            owner,
            preparationId,
            applicationId,
            packetId,
            status,
            snapshot.fingerprint,
            JSON.stringify(result),
            createdAt,
            new Date(Date.parse(createdAt) + minutes(120)).toISOString(),
          ],
        );
        return preparationId;
      };

      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-rebuild-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "rebuild.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `rebuild-${randomUUID()}`;
        now = Date.parse("2026-09-28T12:00:00.000Z");
        repository = new Repository(db, owner, () => new Date(now));
        await repository.initialize();
        exceptions = new ExceptionRepository(db, owner, () => new Date(now));
        handoffs = new HandoffRepository(db, owner, () => new Date(now));

        const candidateId = randomUUID();
        applicationId = randomUUID();
        packetId = randomUUID();
        jobId = randomUUID();
        await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,$2)", [owner, candidateId]);
        await db.query(
          "INSERT INTO jobs(owner_id,id,employer_id,requisition_id,data,created_at,last_seen_at) VALUES($1,$2,'synthetic-employer','req',$3,$4,$4)",
          [owner, jobId, "{}", new Date(now).toISOString()],
        );
        await db.query(
          "INSERT INTO applications(owner_id,id,candidate_id,job_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,'READY',$5,$5)",
          [owner, applicationId, candidateId, jobId, new Date(now).toISOString()],
        );
        await db.query(
          "INSERT INTO packets(owner_id,id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,'{}',$4,$5)",
          [owner, packetId, applicationId, "b".repeat(64), new Date(now).toISOString()],
        );
      });

      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });

      const settleHandoff = async (completedAt: string) => {
        await db.query(
          "UPDATE applications SET state='CHALLENGE_REQUIRED' WHERE owner_id=$1 AND id=$2",
          [owner, applicationId],
        );
        const created = await handoffs.create({
          applicationId,
          preparationId,
          adapterId: "mock-ats",
          targetFingerprint,
        });
        const session = await handoffs.claimHandoff(created.session.id, created.token, "browser:r");
        await handoffs.completeHandoff(created.session.id, "browser:r", session.generation);
        await db.query(
          "UPDATE handoff_sessions SET state='completed',completed_at=$1 WHERE owner_id=$2 AND id=$3",
          [completedAt, owner, created.session.id],
        );
        return created.session.id;
      };

      it("a preparation older than a settled handoff is not silently reusable", async () => {
        await addPreparation(new Date(now - minutes(10)).toISOString(), "challenge");
        await settleHandoff(new Date(now - minutes(5)).toISOString());
        const ready = await addPreparation(new Date(now - minutes(4)).toISOString(), "ready");
        // The rebuild path is the correct recovery: it retires the stale preparation
        // so nothing can present it as a description of the current form.
        await db.query(
          "UPDATE applications SET state='CHALLENGE_REQUIRED' WHERE owner_id=$1 AND id=$2",
          [owner, applicationId],
        );
        await exceptions.rebuild(applicationId);
        expect(
          await db.query(
            "SELECT id FROM browser_preparations WHERE owner_id=$1 AND application_id=$2 AND resolved_at IS NULL AND id=$3",
            [owner, applicationId, ready],
          ),
        ).toHaveLength(0);
      });

      it("rebuild refuses outright while a prior final action is ambiguous", async () => {
        const authorizationId = randomUUID();
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,1,$3,$4,$5)",
          [
            authorizationId,
            owner,
            JSON.stringify({ allowAccountCreation: false, mode: "auto_submit" }),
            new Date(now - minutes(60)).toISOString(),
            new Date(now + minutes(60 * 24 * 30)).toISOString(),
          ],
        );
        const intentId = randomUUID();
        await db.query(
          "INSERT INTO intents(owner_id,id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES($1,$2,$3,$4,$5,'{}',$6,$7)",
          [
            owner,
            intentId,
            applicationId,
            packetId,
            authorizationId,
            "c".repeat(64),
            new Date(now).toISOString(),
          ],
        );
        await db.query(
          "INSERT INTO attempts(owner_id,id,application_id,intent_id,fence,state,started_at) VALUES($1,$2,$3,$4,1,'UNKNOWN',$5)",
          [owner, randomUUID(), applicationId, intentId, new Date(now).toISOString()],
        );
        await db.query("UPDATE applications SET state='UNKNOWN' WHERE owner_id=$1 AND id=$2", [
          owner,
          applicationId,
        ]);
        await expect(exceptions.rebuild(applicationId)).rejects.toMatchObject({
          code: "DUPLICATE_SUSPECTED",
        });
        // Nothing was resumed, so the ambiguity is still the owner's to reconcile.
        expect(
          await db.query("SELECT id FROM tasks WHERE owner_id=$1 AND application_id=$2", [
            owner,
            applicationId,
          ]),
        ).toHaveLength(0);
      });

      it("rebuild retires the stale preparation and the blocking handoff", async () => {
        await addPreparation(new Date(now - minutes(20)).toISOString(), "challenge");
        await db.query(
          "UPDATE applications SET state='CHALLENGE_REQUIRED' WHERE owner_id=$1 AND id=$2",
          [owner, applicationId],
        );
        const created = await handoffs.create({
          applicationId,
          preparationId,
          adapterId: "mock-ats",
          targetFingerprint,
        });
        await handoffs.claimHandoff(created.session.id, created.token, "browser:r");
        const result = await exceptions.rebuild(applicationId);
        expect(result).toEqual({ requeued: 1, reconciliationRequired: false });
        expect(
          String(
            (
              await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
                owner,
                applicationId,
              ])
            )[0]?.state,
          ),
        ).toBe("INSPECTING");
        // The challenged preparation is retired, so nothing can reuse it.
        expect(
          await db.query(
            "SELECT id FROM browser_preparations WHERE owner_id=$1 AND application_id=$2 AND resolved_at IS NULL",
            [owner, applicationId],
          ),
        ).toHaveLength(0);
        expect(
          String(
            (
              await db.query("SELECT state FROM handoff_sessions WHERE owner_id=$1 AND id=$2", [
                owner,
                created.session.id,
              ])
            )[0]?.state,
          ),
        ).toBe("cancelled");
        expect(
          await db.query("SELECT id FROM tasks WHERE owner_id=$1 AND application_id=$2", [
            owner,
            applicationId,
          ]),
        ).toHaveLength(1);
      });

      it("refuses a rebuild from a state where rebuilding is meaningless", async () => {
        await db.query("UPDATE applications SET state='CONFIRMED' WHERE owner_id=$1 AND id=$2", [
          owner,
          applicationId,
        ]);
        await expect(exceptions.rebuild(applicationId)).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
      });
    },
  );
}
