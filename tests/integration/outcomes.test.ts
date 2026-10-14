import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedCohortSchema } from "../../packages/contracts/src/cohort.js";
import type { OutcomeKind } from "../../packages/contracts/src/outcome.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { CohortRepository } from "../../packages/persistence/src/cohort-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { EmailRepository } from "../../packages/persistence/src/email-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { OutcomeRepository } from "../../packages/persistence/src/outcome-repository.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { captureSubmissionMetadata } from "../../packages/persistence/src/submission-metadata.js";
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
      const application = async (synthetic = true, source = documentJob.source) => {
        const id = randomUUID();
        await repo.putJob({ ...documentJob, id, requisitionId: id, synthetic, source });
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
      const receipt = async (
        applicationId: string,
        kind: "legacy" | "greenhouse" | "mock_ats" = "legacy",
      ) => {
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
        const jobId = (
          await db.query("SELECT job_id FROM applications WHERE owner_id=$1 AND id=$2", [
            owner,
            applicationId,
          ])
        )[0]?.job_id;
        const evidence = JSON.stringify(
          kind === "legacy"
            ? { kind: "synthetic-outcome-fixture", applicationId }
            : kind === "greenhouse"
              ? {
                  kind,
                  receiptId: id,
                  board: "synthetic-fixture",
                  postingId: "1",
                  jobId,
                  receiptUrl: "https://receipt.synthetic.example/fixture",
                  receivedAt: at,
                  emailHash: "a".repeat(64),
                }
              : {
                  kind,
                  recordId: id,
                  jobId,
                  receiptUrl: "https://receipt.synthetic.example/fixture",
                  receivedAt: at,
                  emailHash: "a".repeat(64),
                },
        );
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

      const fixedInput = () => ({
        id: randomUUID(),
        from: "2026-08-01T00:00:00.000Z",
        through: "2026-09-30T00:00:00.000Z",
        observationDays: 30,
      });
      const storedCohort = async (id: string) => {
        const [row] = await db.query(
          "SELECT data,sha256,binding FROM outcome_cohorts WHERE owner_id=$1 AND id=$2",
          [owner, id],
        );
        expect(row).toBeDefined();
        expect(row?.sha256).toBe(createHash("sha256").update(String(row?.data)).digest("hex"));
        return { row, snapshot: fixedCohortSchema.parse(JSON.parse(String(row?.data))) };
      };
      it("captures corrected cumulative milestones, group minimums and immutable replay from typed history", async () => {
        const apps: Awaited<ReturnType<typeof application>>[] = [];
        for (let index = 0; index < 21; index++) {
          const app = await application(false, index < 20 ? "source-a" : "source-b");
          await receipt(app.id, "greenhouse");
          apps.push(app);
        }
        const appId = (index: number) => apps[index]?.id as string;
        const screening = await outcomes.recordOwner(input(appId(0), "SCREENING"));
        const interview = await outcomes.recordOwner(input(appId(0), "INTERVIEW", 1));
        await outcomes.recordOwner(input(appId(0), "REJECTION", 2));
        await outcomes.recordOwner(input(appId(1), "OFFER"));
        await outcomes.recordOwner(input(appId(2), "SCREENING"));
        await outcomes.recordOwner(input(appId(2), "UNKNOWN", 1));
        await outcomes.recordOwner(input(appId(2), "INTERVIEW", 2));
        await outcomes.recordOwner(input(appId(3), "INTERVIEW"));
        await outcomes.recordOwner(input(appId(4), "RECEIVED"));
        now = new Date("2026-09-20T00:00:00.000Z");
        await outcomes.recordOwner(input(appId(3), "OFFER", 1));
        now = new Date("2026-10-01T00:00:00.000Z");
        const cohorts = new CohortRepository(db, owner, () => now);
        const control = await repo.getControl();
        const request = fixedInput();
        const report = await cohorts.record(request);
        expect(report).toMatchObject({
          status: "measured",
          denominator: 21,
          counts: { SCREENING: 0, INTERVIEW: 2, OFFER: 1, REJECTION: 1, RECEIVED: 1, UNKNOWN: 16 },
          fractions: { INTERVIEW: { numerator: 2, denominator: 21, fraction: 2 / 21 } },
          cumulative: {
            methodology: "corrected_observed_milestones_v1",
            status: "measured",
            denominator: 21,
            counts: { SCREENING: 1, INTERVIEW: 3, OFFER: 1 },
            fractions: {
              SCREENING: { numerator: 1, denominator: 21, fraction: 1 / 21 },
              INTERVIEW: { numerator: 3, denominator: 21, fraction: 3 / 21 },
              OFFER: { numerator: 1, denominator: 21, fraction: 1 / 21 },
            },
            withoutMilestoneEvidence: 17,
          },
        });
        expect(
          report.groups.find((group) => group.dimension === "source" && group.value === "source-a"),
        ).toMatchObject({
          cumulative: {
            status: "measured",
            denominator: 20,
            counts: { SCREENING: 1, INTERVIEW: 3, OFFER: 1 },
            fractions: { INTERVIEW: { numerator: 3, denominator: 20, fraction: 0.15 } },
            withoutMilestoneEvidence: 16,
          },
        });
        expect(
          report.groups.find((group) => group.dimension === "source" && group.value === "source-b"),
        ).toMatchObject({
          cumulative: {
            status: "insufficient_data",
            denominator: 1,
            counts: { SCREENING: 0, INTERVIEW: 0, OFFER: 0 },
            fractions: null,
            withoutMilestoneEvidence: 1,
          },
        });
        const frozen = await storedCohort(request.id);
        expect(frozen.snapshot.cumulativeMethodology).toBe("corrected_observed_milestones_v1");
        const member = (index: number) =>
          frozen.snapshot.members.find((item) => item.applicationId === appId(index));
        expect(member(0)?.cumulativeEvidence).toEqual({
          historySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          milestones: [interview, screening].map((event) => ({
            kind: event.kind,
            eventId: event.id,
            revision: event.revision,
            evidenceSha256: event.evidenceSha256,
            occurredAt: event.occurredAt,
          })),
        });
        expect(member(1)?.cumulativeEvidence?.milestones.map((event) => event.kind)).toEqual([
          "OFFER",
        ]);
        expect(member(2)?.cumulativeEvidence?.milestones.map((event) => event.kind)).toEqual([
          "INTERVIEW",
        ]);
        expect(member(3)?.cumulativeEvidence?.milestones.map((event) => event.kind)).toEqual([
          "INTERVIEW",
        ]);
        now = new Date("2026-10-02T00:00:00.000Z");
        await outcomes.recordOwner({
          ...input(appId(0), "UNKNOWN", 3),
          occurredAt: "2026-08-10T00:00:00.000Z",
        });
        expect(await new CohortRepository(db, owner, () => now).report(request.id)).toEqual(report);
        expect(await cohorts.record(request)).toEqual(report);
        expect((await storedCohort(request.id)).row).toEqual(frozen.row);
        expect(await repo.getControl()).toEqual(control);
        expect(
          await db.query(
            "SELECT id FROM audit_events WHERE owner_id=$1 AND action='outcome.cohort_recorded'",
            [owner],
          ),
        ).toHaveLength(1);
      });

      it("rebases restoration to the target branch and restores milestones after an UNKNOWN reset", async () => {
        const app = await application(false);
        await receipt(app.id, "greenhouse");
        const screening = await outcomes.recordOwner(input(app.id, "SCREENING"));
        const interview = await outcomes.recordOwner(input(app.id, "INTERVIEW", 1));
        const offer = await outcomes.recordOwner(input(app.id, "OFFER", 2));
        now = new Date("2026-08-02T00:00:00.000Z");
        await outcomes.reverse(app.id, screening.id, 3, randomUUID());
        now = new Date("2026-10-01T00:00:00.000Z");
        const cohorts = new CohortRepository(db, owner, () => now);
        const first = await cohorts.record(fixedInput());
        expect(first).toMatchObject({
          counts: { SCREENING: 1, OFFER: 0 },
          cumulative: {
            status: "insufficient_data",
            counts: { SCREENING: 1, INTERVIEW: 0, OFFER: 0 },
            fractions: null,
          },
        });
        // Backdated owner corrections are known only to subsequent snapshots.
        await outcomes.recordOwner({
          ...input(app.id, "UNKNOWN", 4),
          occurredAt: "2026-08-03T00:00:00.000Z",
        });
        const reset = await cohorts.record(fixedInput());
        expect(reset).toMatchObject({
          cumulative: {
            counts: { SCREENING: 0, INTERVIEW: 0, OFFER: 0 },
            withoutMilestoneEvidence: 1,
          },
        });
        // Restoration itself must occur inside this new snapshot's observation horizon.
        // A 90-day horizon includes the October restoration without altering older captures.
        await outcomes.reverse(app.id, offer.id, 5, randomUUID());
        now = new Date("2026-11-01T00:00:00.000Z");
        const restored = await cohorts.record({ ...fixedInput(), observationDays: 90 });
        expect(restored).toMatchObject({
          counts: { OFFER: 1 },
          cumulative: {
            status: "insufficient_data",
            denominator: 1,
            counts: { SCREENING: 1, INTERVIEW: 1, OFFER: 1 },
            fractions: null,
            withoutMilestoneEvidence: 0,
          },
        });
        const { snapshot } = await storedCohort(restored.snapshotId);
        expect(
          snapshot.members[0]?.cumulativeEvidence?.milestones.map((event) => event.eventId).sort(),
        ).toEqual([screening.id, interview.id, offer.id].sort());
        expect(await cohorts.report(first.snapshotId)).toEqual(first);
        expect(await cohorts.report(reset.snapshotId)).toEqual(reset);
      });

      it.each([
        ["broken predecessor", "previous_event_id=NULL", "restored"],
        ["revision gap", "revision=9", "restored"],
        ["invalid restoration digest", `evidence_sha256='${"f".repeat(64)}'`, "restored"],
        ["invalid restoration target", "evidence_ref='missing-target'", "restored"],
        ["invalid actor", "actor='mail-correlator'", "restored"],
        ["invalid timeline", "occurred_at='2027-01-01T00:00:00.000Z'", "restored"],
        ["invalid actor on discarded branch", "actor='mail-correlator'", "discarded"],
      ])(
        "refuses %s in full stored history without persisting a partial cohort",
        async (_label, mutation, target) => {
          const app = await application(false);
          await receipt(app.id, "greenhouse");
          const first = await outcomes.recordOwner(input(app.id));
          const discarded = await outcomes.recordOwner(input(app.id, "OFFER", 1));
          const restored = await outcomes.reverse(app.id, first.id, 2, randomUUID());
          await db.query(`UPDATE outcome_events SET ${mutation} WHERE owner_id=$1 AND id=$2`, [
            owner,
            target === "discarded" ? discarded.id : restored.id,
          ]);
          now = new Date("2026-10-01T00:00:00.000Z");
          const control = await repo.getControl();
          const cohorts = new CohortRepository(db, owner, () => now);
          await expect(cohorts.record(fixedInput())).rejects.toMatchObject({
            code: "STATE_INVALID",
          });
          expect(await cohorts.list()).toEqual([]);
          expect(
            await db.query(
              "SELECT id FROM audit_events WHERE owner_id=$1 AND action='outcome.cohort_recorded'",
              [owner],
            ),
          ).toEqual([]);
          expect(await repo.getControl()).toEqual(control);
        },
      );

      it("keeps persisted legacy cohorts immutable with cumulative data unavailable", async () => {
        const app = await application(false);
        await receipt(app.id, "greenhouse");
        await outcomes.recordOwner(input(app.id));
        now = new Date("2026-10-01T00:00:00.000Z");
        const cohorts = new CohortRepository(db, owner, () => now);
        const request = fixedInput();
        const current = await cohorts.record(request);
        const { snapshot } = await storedCohort(request.id);
        const { cumulativeMethodology: _method, ...legacy } = snapshot;
        const data = JSON.stringify({
          ...legacy,
          members: legacy.members.map(({ cumulativeEvidence: _evidence, ...member }) => member),
        });
        await db.query("UPDATE outcome_cohorts SET data=$1,sha256=$2 WHERE owner_id=$3 AND id=$4", [
          data,
          createHash("sha256").update(data).digest("hex"),
          owner,
          request.id,
        ]);
        const frozen = await storedCohort(request.id);
        const report = await cohorts.report(request.id);
        const unavailable = {
          status: "unavailable",
          denominator: 1,
          counts: null,
          fractions: null,
          withoutMilestoneEvidence: null,
        };
        expect(report).toMatchObject({
          counts: current.counts,
          fractions: current.fractions,
          cumulative: unavailable,
        });
        for (const group of report.groups) expect(group).toMatchObject({ cumulative: unavailable });
        now = new Date("2026-10-02T00:00:00.000Z");
        await outcomes.recordOwner(input(app.id, "OFFER", 1));
        expect(await cohorts.record(request)).toEqual(report);
        expect(await cohorts.report(request.id)).toEqual(report);
        expect((await storedCohort(request.id)).row).toEqual(frozen.row);
        const other = new CohortRepository(db, `other-${owner}`, () => now);
        await expect(other.report(request.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
      it("freezes canonical receipt-verified cohorts and horizon labels without changing authority", async () => {
        const cohorts = new CohortRepository(db, owner, () => now);
        const first = [];
        // Test-only non-synthetic flags and typed receipts exercise arithmetic, not live evidence.
        for (let index = 0; index < 40; index++) {
          const app = await application(false, index < 20 ? "source-a" : "source-b");
          await receipt(app.id, "greenhouse");
          await outcomes.recordOwner(input(app.id, index < 20 ? "INTERVIEW" : "REJECTION"));
          first.push(app);
        }
        now = new Date("2026-09-20T00:00:00.000Z");
        await outcomes.recordOwner(input(first[0]?.id as string, "OFFER", 1));
        now = new Date("2026-10-01T00:00:00.000Z");
        const control = await repo.getControl(),
          request = fixedInput();
        const report = await cohorts.record(request);
        expect(report).toMatchObject({
          denominator: 40,
          status: "measured",
          counts: { INTERVIEW: 20, REJECTION: 20, OFFER: 0 },
        });
        expect(report.groups.find((group) => group.dimension === "sponsorship")).toMatchObject({
          value: "unknown",
          denominator: 40,
        });
        const comparison = await cohorts.compare({
          leftSnapshotId: request.id,
          rightSnapshotId: request.id,
          dimension: "source",
          leftValue: "source-a",
          rightValue: "source-b",
        });
        expect(comparison).toMatchObject({
          status: "measured",
          differences: { INTERVIEW: 1, REJECTION: -1 },
          left: { denominator: 20 },
          right: { denominator: 20 },
        });
        await application(false, "source-c");
        await db.query("UPDATE jobs SET data='{}' WHERE owner_id=$1", [owner]);
        await outcomes.recordOwner(input(first[1]?.id as string, "UNKNOWN", 1));
        expect(await cohorts.record(request)).toEqual(report);
        expect(await cohorts.report(request.id)).toEqual(report);
        expect(
          await cohorts.compare({
            leftSnapshotId: request.id,
            rightSnapshotId: request.id,
            dimension: "source",
            leftValue: "source-a",
            rightValue: "source-b",
          }),
        ).toEqual(comparison);
        expect(await repo.getControl()).toEqual(control);
        expect((await cohorts.list())[0]?.id).toBe(request.id);
        expect(
          await db.query(
            "SELECT * FROM audit_events WHERE owner_id=$1 AND action='outcome.cohort_recorded'",
            [owner],
          ),
        ).toHaveLength(1);
        await expect(cohorts.record({ ...request, observationDays: 31 })).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
      });
      it("uses intent-time metadata after job edits and rejects corrupt or misbound metadata", async () => {
        const app = await application(false, "source-at-submission");
        const id = await receipt(app.id, "greenhouse");
        const jobId = String(
          (
            await db.query("SELECT job_id FROM applications WHERE owner_id=$1 AND id=$2", [
              owner,
              app.id,
            ])
          )[0]?.job_id,
        );
        const metadata = await captureSubmissionMetadata(db, owner, jobId);
        const snapshot = { applicationId: app.id, jobId, packetId: id, cohortMetadata: metadata };
        const persist = async (value: unknown, checksum?: string) => {
          const raw = JSON.stringify(value);
          await db.query("UPDATE intents SET snapshot=$1,sha256=$2 WHERE owner_id=$3 AND id=$4", [
            raw,
            checksum ?? createHash("sha256").update(raw).digest("hex"),
            owner,
            id,
          ]);
        };
        await persist(snapshot);
        const job = JSON.parse(
          String(
            (await db.query("SELECT data FROM jobs WHERE owner_id=$1 AND id=$2", [owner, jobId]))[0]
              ?.data,
          ),
        );
        await db.query("UPDATE jobs SET data=$1 WHERE owner_id=$2 AND id=$3", [
          JSON.stringify({ ...job, source: "later-source" }),
          owner,
          jobId,
        ]);
        now = new Date("2026-10-01T00:00:00.000Z");
        const cohorts = new CohortRepository(db, owner, () => now);
        const report = await cohorts.record(fixedInput());
        expect(report.metadataOrigins).toEqual({ submissionIntent: 1, legacySnapshot: 0 });
        expect(report.groups.filter((group) => group.dimension === "source")).toMatchObject([
          { value: "source-at-submission", denominator: 1 },
        ]);
        for (const value of [
          { ...snapshot, applicationId: "wrong-application" },
          { ...snapshot, jobId: "wrong-job" },
          { ...snapshot, packetId: "wrong-packet" },
          { ...snapshot, cohortMetadata: { ...metadata, jobId: "wrong-job" } },
          { ...snapshot, cohortMetadata: null },
        ]) {
          await persist(value);
          await expect(cohorts.record(fixedInput())).rejects.toMatchObject({
            code: "STATE_INVALID",
          });
        }
        await persist(snapshot, "f".repeat(64));
        await expect(cohorts.record(fixedInput())).rejects.toMatchObject({ code: "STATE_INVALID" });
        await persist({ ...snapshot, cohortMetadata: { ...metadata, synthetic: true } });
        expect(await cohorts.record(fixedInput())).toMatchObject({
          denominator: 0,
          exclusions: { synthetic: 1 },
        });
        expect(await cohorts.report(report.snapshotId)).toEqual(report);
      });

      it("excludes synthetic, mock, malformed, unresolved, duplicate and recent evidence", async () => {
        const cohorts = new CohortRepository(db, owner, () => now);
        await receipt((await application()).id, "greenhouse");
        await receipt((await application(false)).id, "mock_ats");
        const invalid = await receipt((await application(false)).id, "greenhouse");
        await db.query("UPDATE receipts SET evidence='not-json' WHERE owner_id=$1 AND id=$2", [
          owner,
          invalid,
        ]);
        const unresolved = await application(false);
        await receipt(unresolved.id, "greenhouse");
        await db.query("UPDATE applications SET state='UNKNOWN' WHERE owner_id=$1 AND id=$2", [
          owner,
          unresolved.id,
        ]);
        const a = await application(false),
          b = await application(false);
        await receipt(a.id, "greenhouse");
        await receipt(b.id, "greenhouse");
        await db.query(
          "INSERT INTO identity_resolutions(owner_id,id,from_job_id,to_job_id,reason,created_at) VALUES($1,$2,$3,$4,'synthetic-fixture',$5)",
          [owner, randomUUID(), b.jobId, a.jobId, now.toISOString()],
        );
        now = new Date("2026-09-25T00:00:00.000Z");
        await receipt((await application(false)).id, "greenhouse");
        now = new Date("2026-10-01T00:00:00.000Z");
        const report = await cohorts.record(fixedInput());
        expect(report).toMatchObject({
          denominator: 1,
          fractions: null,
          counts: { UNKNOWN: 1 },
          exclusions: {
            synthetic: 1,
            unverified: 2,
            unresolved: 1,
            duplicate: 1,
            stillObserving: 1,
          },
        });
        expect(report.groups.every((group) => group.fractions === null)).toBe(true);
      });
      it("refuses incompatible comparisons, caller timestamps, unknown groups and tenant access", async () => {
        const cohorts = new CohortRepository(db, owner, () => now);
        const a = await application(false, "source-a"),
          b = await application(false, "source-b");
        await receipt(a.id, "greenhouse");
        await receipt(b.id, "greenhouse");
        now = new Date("2026-10-01T00:00:00.000Z");
        const left = fixedInput(),
          right = { ...fixedInput(), observationDays: 31 };
        await cohorts.record(left);
        await cohorts.record(right);
        const compare = {
          leftSnapshotId: left.id,
          rightSnapshotId: right.id,
          dimension: "source",
          leftValue: "source-a",
          rightValue: "source-b",
        };
        await expect(cohorts.compare(compare)).rejects.toMatchObject({ code: "STATE_INVALID" });
        expect(await cohorts.compare({ ...compare, rightSnapshotId: left.id })).toMatchObject({
          status: "insufficient_data",
          differences: null,
        });
        await expect(
          cohorts.compare({ ...compare, rightSnapshotId: left.id, leftValue: "missing" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          cohorts.compare({ ...compare, rightSnapshotId: left.id, rightValue: "source-a" }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        await expect(
          cohorts.record({ ...fixedInput(), asOf: now.toISOString() }),
        ).rejects.toThrow();
        const other = new CohortRepository(db, `other-${owner}`, () => now);
        expect(await other.list()).toEqual([]);
        await expect(other.report(left.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await db.query("UPDATE outcome_cohorts SET data='{}' WHERE owner_id=$1 AND id=$2", [
          owner,
          left.id,
        ]);
        await expect(cohorts.report(left.id)).rejects.toMatchObject({ code: "STATE_INVALID" });
        await expect(cohorts.record(left)).rejects.toMatchObject({ code: "STATE_INVALID" });
        await expect(cohorts.list()).rejects.toMatchObject({ code: "STATE_INVALID" });
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
