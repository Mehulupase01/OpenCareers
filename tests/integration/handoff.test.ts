import { randomUUID } from "node:crypto";
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
import { HandoffRepository } from "../../packages/persistence/src/handoff-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} scoped challenge handoff`,
    () => {
      let db: Database;
      let dir: string;
      let owner: string;
      let applicationId: string;
      let preparationId: string;
      let now: number;
      const targetFingerprint = "a".repeat(64);

      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-handoff-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "handoff.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `handoff-${randomUUID()}`;
        await new Repository(db, owner).initialize();
        const candidateId = randomUUID();
        applicationId = randomUUID();
        preparationId = randomUUID();
        const packetId = randomUUID();
        const jobId = randomUUID();
        await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,$2)", [owner, candidateId]);
        await db.query(
          "INSERT INTO jobs(owner_id,id,employer_id,requisition_id,data,created_at,last_seen_at) VALUES($1,$2,'synthetic-employer','req',$3,$4,$4)",
          [owner, jobId, "{}", "2026-09-28T12:00:00.000Z"],
        );
        await db.query(
          "INSERT INTO applications(owner_id,id,candidate_id,job_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,'CHALLENGE_REQUIRED',$5,$5)",
          [owner, applicationId, candidateId, jobId, "2026-09-28T12:00:00.000Z"],
        );
        await db.query(
          "INSERT INTO packets(owner_id,id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,'{}',$4,$5)",
          [owner, packetId, applicationId, "b".repeat(64), "2026-09-28T12:00:00.000Z"],
        );
        const snapshot = {
          url: "http://127.0.0.1:4320/jobs/challenge",
          origin: "http://127.0.0.1:4320",
          jobId,
          step: 1,
          fields: [],
          fingerprint: "c".repeat(64),
          blocker: "challenge" as const,
        };
        const result = dryRunResultSchema.parse({
          adapter: { id: "mock-ats", version: "mock-ats-v1", targetFingerprint },
          packetId,
          applicationId,
          status: "challenge",
          snapshots: [snapshot],
          plans: [{ fingerprint: snapshot.fingerprint, entries: [], unresolved: [] }],
          reports: [
            {
              snapshot,
              status: "challenge",
              readBack: [],
              uploadStatus: "idle",
              issues: ["Verification challenge requires owner action."],
            },
          ],
          issues: ["Verification challenge requires owner action."],
          blockedFinalActions: 0,
          serverApplicationCount: 0,
          preparedAt: "2026-09-28T12:00:00.000Z",
        });
        await db.query(
          "INSERT INTO browser_preparations(owner_id,id,application_id,packet_id,status,form_fingerprint,result,created_at,expires_at) VALUES($1,$2,$3,$4,'challenge',$5,$6,$7,$8)",
          [
            owner,
            preparationId,
            applicationId,
            packetId,
            snapshot.fingerprint,
            JSON.stringify(result),
            "2026-09-28T12:00:00.000Z",
            "2026-09-28T12:15:00.000Z",
          ],
        );
        now = Date.parse("2026-09-28T12:01:00.000Z");
      });

      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });

      it("uses an owner-bound one-time token and exclusive browser generation", async () => {
        const repo = new HandoffRepository(db, owner, () => new Date(now));
        const created = await repo.create({
          applicationId,
          preparationId,
          adapterId: "mock-ats",
          targetFingerprint,
        });
        expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(JSON.stringify(await repo.snapshot())).not.toContain(created.token);
        await expect(
          repo.claimHandoff(created.session.id, "wrong-token", "browser-a"),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        await expect(
          repo.claimHandoff(created.session.id, "A".repeat(43), "browser-a"),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        const otherOwner = `other-${randomUUID()}`;
        await new Repository(db, otherOwner).initialize();
        await expect(
          new HandoffRepository(db, otherOwner, () => new Date(now)).claimHandoff(
            created.session.id,
            created.token,
            "browser-a",
          ),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const claimed = await repo.claimHandoff(created.session.id, created.token, "browser-a");
        await expect(
          repo.claimHandoff(created.session.id, created.token, "browser-b"),
        ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
        await expect(
          repo.completeHandoff(claimed.id, "browser-b", claimed.generation),
        ).rejects.toMatchObject({ code: "LEASE_STALE" });
        const completed = await repo.completeHandoff(claimed.id, "browser-a", claimed.generation);
        expect(completed).toMatchObject({ state: "rebuilding", generation: 2 });
        expect(
          await db.query(
            "SELECT resolved_at FROM browser_preparations WHERE owner_id=$1 AND id=$2",
            [owner, preparationId],
          ),
        ).toEqual([{ resolved_at: "2026-09-28T12:01:00.000Z" }]);
      });

      it("rejects target drift and expired preparations", async () => {
        const repo = new HandoffRepository(db, owner, () => new Date(now));
        await expect(
          repo.create({
            applicationId,
            preparationId,
            adapterId: "mock-ats",
            targetFingerprint: "d".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "FORM_CHANGED" });
        now = Date.parse("2026-09-28T12:16:00.000Z");
        await expect(
          repo.create({ applicationId, preparationId, adapterId: "mock-ats", targetFingerprint }),
        ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      });

      it("retires an expired handoff before creating its replacement", async () => {
        const repo = new HandoffRepository(db, owner, () => new Date(now));
        const first = await repo.create({
          applicationId,
          preparationId,
          adapterId: "mock-ats",
          targetFingerprint,
          ttlMs: 60_000,
        });
        now += 60_001;
        const second = await repo.create({
          applicationId,
          preparationId,
          adapterId: "mock-ats",
          targetFingerprint,
        });
        expect(second.session.id).not.toBe(first.session.id);
        expect(await repo.snapshot()).toEqual([
          expect.objectContaining({ id: second.session.id, state: "open" }),
          expect.objectContaining({ id: first.session.id, state: "expired" }),
        ]);
      });
    },
  );
}
