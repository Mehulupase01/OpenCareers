import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OutcomeKind } from "../../packages/contracts/src/outcome.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { EmailRepository } from "../../packages/persistence/src/email-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { OutcomeRepository } from "../../packages/persistence/src/outcome-repository.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { documentGenerationInput, documentJob } from "../fixtures/document-packets.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} outcome ledger`,
    () => {
      let db: Database;
      let owner: string;
      let now: Date;
      let repo: Repository;
      let outcomes: OutcomeRepository;
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `outcomes-${randomUUID()}`;
        now = new Date("2026-08-01T00:00:00.000Z");
        repo = new Repository(db, owner, () => now);
        await repo.initialize();
        outcomes = new OutcomeRepository(db, owner, () => now);
      });
      afterEach(async () => {
        await db?.close();
      });
      const application = async (synthetic = true) => {
        const id = randomUUID();
        await repo.putJob({ ...documentJob, id, requisitionId: id, synthetic });
        return repo.createApplication(id, "synthetic-candidate");
      };
      const input = (
        applicationId: string,
        kind: OutcomeKind = "INTERVIEW",
        expectedRevision = 0,
      ) => ({
        applicationId,
        kind,
        expectedRevision,
        requestId: randomUUID(),
        evidenceRef: "synthetic-evidence",
        evidenceSha256: "a".repeat(64),
        occurredAt: now.toISOString(),
      });
      const mail = async (
        applicationId: string,
        classification: string,
        correlation = "correlated",
        contextKind = "application",
      ) => {
        const id = randomUUID();
        await db.query(
          "INSERT INTO email_messages(owner_id,id,mailbox_hash,provider_message_id,sha256,classification,correlation,context_id,context_kind,received_at,created_at) VALUES($1,$2,'synthetic-mailbox',$2,$3,$4,$5,$6,$7,$8,$8)",
          [
            owner,
            id,
            "b".repeat(64),
            classification,
            correlation,
            applicationId,
            contextKind,
            now.toISOString(),
          ],
        );
        return id;
      };
      // Test-only FK-complete rows; these are never live employer evidence.
      const receipt = async (applicationId: string) => {
        const id = randomUUID();
        const at = now.toISOString();
        await db.query(
          "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,$3,'{}',$4,'2027-01-01T00:00:00.000Z')",
          [
            id,
            owner,
            (await db.query("SELECT id FROM authorizations WHERE owner_id=$1", [owner])).length + 1,
            at,
          ],
        );
        await db.query(
          "INSERT INTO packets(id,owner_id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,'{}',$1,$4)",
          [id, owner, applicationId, at],
        );
        await db.query(
          "INSERT INTO intents(id,owner_id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES($1,$2,$3,$1,$1,'{}',$1,$4)",
          [id, owner, applicationId, at],
        );
        await db.query(
          "INSERT INTO attempts(id,owner_id,application_id,intent_id,fence,state,started_at) VALUES($1,$2,$3,$1,1,'CONFIRMED',$4)",
          [id, owner, applicationId, at],
        );
        const evidence = JSON.stringify({ kind: "synthetic-outcome-fixture", applicationId });
        await db.query(
          "INSERT INTO receipts(id,owner_id,application_id,attempt_id,evidence,sha256,observed_at) VALUES($1,$2,$3,$1,$4,$5,$6)",
          [
            id,
            owner,
            applicationId,
            evidence,
            createHash("sha256").update(evidence).digest("hex"),
            at,
          ],
        );
        await db.query("UPDATE applications SET state='CONFIRMED' WHERE owner_id=$1 AND id=$2", [
          owner,
          applicationId,
        ]);
        return id;
      };
      const window = () => ({
        from: "2026-08-01T00:00:00.000Z",
        through: "2026-09-30T00:00:00.000Z",
        asOf: now.toISOString(),
        observationDays: 30,
      });

      it("records attributed history without changing application state or policy", async () => {
        const app = await application();
        const control = await repo.getControl();
        const event = await outcomes.recordOwner(input(app.id));
        expect(event).toMatchObject({
          applicationId: app.id,
          revision: 1,
          source: "owner",
          actor: "owner",
          evidenceSha256: "a".repeat(64),
          previousEventId: null,
        });
        expect(await outcomes.history(app.id)).toEqual([event]);
        expect(
          (
            await db.query("SELECT state,revision FROM applications WHERE owner_id=$1 AND id=$2", [
              owner,
              app.id,
            ])
          )[0],
        ).toMatchObject({ state: "DISCOVERED", revision: 0 });
        expect(await repo.getControl()).toEqual(control);
        expect(
          await db.query("SELECT * FROM authorizations WHERE owner_id=$1", [owner]),
        ).toHaveLength(0);
        expect(
          (
            await db.query(
              "SELECT actor FROM audit_events WHERE owner_id=$1 AND action='outcome.recorded'",
              [owner],
            )
          )[0]?.actor,
        ).toBe("owner");
      });
      it("isolates owners and refuses missing applications and invalid evidence", async () => {
        const app = await application();
        const otherOwner = `other-${owner}`;
        await new Repository(db, otherOwner, () => now).initialize();
        const other = new OutcomeRepository(db, otherOwner, () => now);
        await expect(other.history(app.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(other.recordOwner(input(app.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(outcomes.recordOwner(input("missing"))).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(
          outcomes.recordOwner({ ...input(app.id), evidenceSha256: "invalid" }),
        ).rejects.toThrow();
        for (const occurredAt of ["2026-07-31T00:00:00.000Z", "2026-08-02T00:00:00.000Z"])
          await expect(
            outcomes.recordOwner({ ...input(app.id), occurredAt }),
          ).rejects.toMatchObject({ code: "STATE_INVALID" });
        expect(await outcomes.history(app.id)).toEqual([]);
      });
      it("has one revision winner and binds idempotency to the exact request", async () => {
        const app = await application();
        const first = input(app.id);
        const a = outcomes.recordOwner(first);
        const b = outcomes.recordOwner(input(app.id, "REJECTION"));
        const results = await Promise.allSettled([a, b]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.find((r) => r.status === "rejected")).toMatchObject({
          reason: { code: "REVISION_STALE" },
        });
        const event = (await outcomes.history(app.id))[0];
        expect(event).toBeDefined();
        if (results[0]?.status === "fulfilled") {
          expect(await outcomes.recordOwner(first)).toEqual(event);
          await expect(outcomes.recordOwner({ ...first, kind: "OFFER" })).rejects.toMatchObject({
            code: "REVISION_STALE",
          });
        }
      });
      it("reverses by appending a correction and preserves retries after time advances", async () => {
        const app = await application();
        const first = await outcomes.recordOwner(input(app.id));
        const second = await outcomes.recordOwner(input(app.id, "REJECTION", 1));
        const requestId = randomUUID();
        const restored = await outcomes.reverse(app.id, first.id, 2, requestId);
        now = new Date(now.getTime() + 1000);
        expect(await outcomes.reverse(app.id, first.id, 2, requestId)).toEqual(restored);
        expect(restored).toMatchObject({
          kind: "INTERVIEW",
          source: "reversal",
          revision: 3,
          evidenceRef: first.id,
          previousEventId: second.id,
        });
        expect(await outcomes.history(app.id)).toEqual([first, second, restored]);
        await expect(outcomes.reverse(app.id, second.id, 2, requestId)).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
      });
      it("attributes mail only to correlated applications, not accounts or ambiguous messages", async () => {
        const app = await application();
        for (const [classification, correlation, context] of [
          ["ambiguous", "correlated", "application"],
          ["rejection", "unrelated", "application"],
          ["application_received", "correlated", "account"],
          ["verification", "correlated", "application"],
        ]) {
          expect(
            await outcomes.recordMail(
              await mail(app.id, classification as string, correlation, context),
            ),
          ).toEqual({ status: "ignored", kind: "UNKNOWN" });
        }
        const id = await mail(app.id, "interview");
        const recorded = await outcomes.recordMail(id);
        expect(recorded).toMatchObject({
          status: "recorded",
          event: { kind: "INTERVIEW", source: "email", evidenceRef: id, actor: "mail-correlator" },
        });
        expect(await outcomes.recordMail(id)).toEqual(recorded);
        expect(await outcomes.history(app.id)).toHaveLength(1);
        expect(
          (
            await db.query("SELECT state FROM applications WHERE owner_id=$1 AND id=$2", [
              owner,
              app.id,
            ])
          )[0]?.state,
        ).toBe("DISCOVERED");
      });
      it("does not regress advanced outcomes on late receipts or override owner corrections", async () => {
        const app = await application();
        await outcomes.recordMail(await mail(app.id, "interview"));
        now = new Date(now.getTime() + 1000);
        expect(await outcomes.recordMail(await mail(app.id, "application_received"))).toEqual({
          status: "ignored",
          kind: "UNKNOWN",
        });
        await outcomes.recordOwner(input(app.id, "OFFER", 1));
        now = new Date(now.getTime() + 1000);
        expect(await outcomes.recordMail(await mail(app.id, "rejection"))).toEqual({
          status: "ignored",
          kind: "UNKNOWN",
        });
        expect(await outcomes.history(app.id)).toHaveLength(2);
      });
      it("refuses fractions below sample size and never interprets silence as rejection", async () => {
        const app = await application(false);
        await receipt(app.id);
        now = new Date("2026-10-01T00:00:00.000Z");
        expect(await outcomes.cohort(window())).toMatchObject({
          status: "insufficient_data",
          denominator: 1,
          counts: { UNKNOWN: 1 },
          fractions: null,
          advisoryOnly: true,
        });
        await expect(
          outcomes.cohort({ ...window(), asOf: "2026-10-02T00:00:00.000Z" }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        await expect(outcomes.cohort({ ...window(), minimumSample: 1 })).rejects.toThrow();
      });
      it("reports mature verified denominators, exclusions, and an as-of knowledge cutoff", async () => {
        const apps = [];
        for (let i = 0; i < 20; i++) {
          const app = await application(false);
          await receipt(app.id);
          apps.push(app);
        }
        await outcomes.recordOwner(input(apps[0]?.id as string));
        await receipt((await application()).id);
        await application(false);
        const unresolved = await application(false);
        await receipt(unresolved.id);
        await db.query("UPDATE applications SET state='UNKNOWN' WHERE owner_id=$1 AND id=$2", [
          owner,
          unresolved.id,
        ]);
        now = new Date("2026-09-25T00:00:00.000Z");
        await receipt((await application(false)).id);
        now = new Date("2026-10-01T00:00:00.000Z");
        const cutoff = window();
        const report = await outcomes.cohort(cutoff);
        expect(report).toMatchObject({
          status: "measured",
          denominator: 20,
          counts: { INTERVIEW: 1, UNKNOWN: 19 },
          exclusions: { synthetic: 1, unverified: 1, stillObserving: 1, unresolved: 1 },
          fractions: {
            INTERVIEW: { numerator: 1, denominator: 20, fraction: 0.05 },
            UNKNOWN: { numerator: 19, denominator: 20, fraction: 0.95 },
          },
        });
        now = new Date("2026-10-02T00:00:00.000Z");
        await outcomes.recordOwner({
          ...input(apps[0]?.id as string, "REJECTION", 1),
          occurredAt: "2026-09-01T00:00:00.000Z",
        });
        expect(await outcomes.cohort(cutoff)).toEqual(report);
        expect(JSON.stringify(report)).not.toMatch(/probability|chance|forecast/);
      });
      it("enforces application attribution in SQL even outside repository methods", async () => {
        await expect(
          db.query(
            "INSERT INTO application_outcomes(owner_id,application_id,revision,event_id) VALUES($1,'missing',1,'missing')",
            [owner],
          ),
        ).rejects.toThrow();
      });
      it("retains bounded application mail contexts beyond two weeks and ages them out after 180 days", async () => {
        const app = await application();
        const packetId = await receipt(app.id);
        const content = generatePacketContent(documentGenerationInput());
        await db.query(
          "INSERT INTO profile_versions(id,owner_id,candidate_id,revision,data,created_at) VALUES($1,$2,'synthetic-candidate',1,'{}',$3)",
          [content.profileId, owner, now.toISOString()],
        );
        await db.query(
          "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,application_id,revision,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,1,'{}',$6,$7)",
          [
            owner,
            content.assessmentId,
            app.jobId,
            content.profileId,
            app.id,
            "a".repeat(64),
            now.toISOString(),
          ],
        );
        await db.query(
          "INSERT INTO packet_contents(owner_id,packet_id,profile_id,assessment_id,content,validation) VALUES($1,$2,$3,$4,$5,'{}')",
          [owner, packetId, content.profileId, content.assessmentId, JSON.stringify(content)],
        );
        await db.query("UPDATE intents SET sha256=$1 WHERE owner_id=$2 AND id=$3", [
          createHash("sha256").update("{}").digest("hex"),
          owner,
          packetId,
        ]);
        now = new Date("2026-09-01T00:00:00.000Z");
        const mailbox = new EmailRepository(
          db,
          owner,
          Buffer.alloc(32, 17).toString("base64"),
          () => now,
        );
        expect(await mailbox.contexts()).toMatchObject([
          {
            id: app.id,
            kind: "application",
            attemptId: packetId,
            after: "2026-08-01T00:00:00.000Z",
          },
        ]);
        now = new Date("2027-03-01T00:00:00.000Z");
        expect(await mailbox.contexts()).toEqual([]);
      });
    },
  );
}
