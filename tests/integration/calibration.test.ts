import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalibrationRepository } from "../../packages/persistence/src/calibration-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { documentAssessment, documentJob, documentProfile } from "../fixtures/document-packets.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} fixed calibration datasets`,
    () => {
      let db: Database;
      let repo: Repository;
      let calibration: CalibrationRepository;
      let owner: string;
      const now = () => new Date("2026-10-01T00:00:00.000Z");
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `calibration-${randomUUID()}`;
        repo = new Repository(db, owner, now);
        await repo.initialize();
        calibration = new CalibrationRepository(db, owner, now);
        await db.query(
          "INSERT INTO profile_versions(id,owner_id,candidate_id,revision,data,created_at) VALUES($1,$2,'synthetic-candidate',1,'{}',$3)",
          [documentProfile.id, owner, "2026-09-01T00:00:00.000Z"],
        );
      });
      afterEach(async () => {
        await db?.close();
      });
      const assessment = async (
        synthetic = true,
        score = 50,
        modelId: string | null = null,
        existingJobId?: string,
      ) => {
        const jobId = existingJobId ?? randomUUID();
        if (!existingJobId)
          await repo.putJob({ ...documentJob, id: jobId, requisitionId: jobId, synthetic });
        const id = randomUUID();
        const revision = existingJobId ? 2 : 1;
        const data = JSON.stringify({
          ...documentAssessment,
          id,
          revision,
          jobId,
          applicationId: null,
          modelId,
          provider: null,
          createdAt: "2026-09-17T00:00:00.000Z",
          score: { ...documentAssessment.score, total: score },
        });
        await db.query(
          "INSERT INTO match_assessments(owner_id,id,job_id,profile_id,revision,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            owner,
            id,
            jobId,
            documentProfile.id,
            revision,
            data,
            hash(data),
            "2026-09-17T00:00:00.000Z",
          ],
        );
        return { id, jobId };
      };
      const label = (assessmentId: string, relevant = true) => ({
        assessmentId,
        relevant,
        reviewedAt: "2026-09-20T00:00:00.000Z",
        evidenceRef: "synthetic-owner-review",
        evidenceSha256: "a".repeat(64),
      });
      const dataset = (labels: ReturnType<typeof label>[]) => ({
        id: randomUUID(),
        from: "2026-09-01T00:00:00.000Z",
        through: "2026-09-30T00:00:00.000Z",
        labels,
      });
      it("binds fixed reviews to stored scores and preserves exact retry without changing policy", async () => {
        const sample = await assessment();
        const input = dataset([label(sample.id)]);
        const before = await repo.getControl();
        const report = await calibration.record(input);
        expect(await calibration.list()).toEqual([
          {
            id: input.id,
            window: report.window,
            status: report.status,
            sampleSize: 0,
            synthetic: 1,
          },
        ]);
        expect(report).toMatchObject({
          status: "insufficient_data",
          sampleSize: 0,
          exclusions: { synthetic: 1 },
          metrics: null,
          advisoryOnly: true,
        });
        expect(await calibration.record(input)).toEqual(report);
        expect(await calibration.report(input.id)).toEqual(report);
        expect(await repo.getControl()).toEqual(before);
        expect(await db.query("SELECT * FROM authorizations WHERE owner_id=$1", [owner])).toEqual(
          [],
        );
        expect(
          await db.query(
            "SELECT * FROM audit_events WHERE owner_id=$1 AND action='calibration.dataset_recorded'",
            [owner],
          ),
        ).toHaveLength(1);
        await expect(
          calibration.record({ ...input, labels: [label(sample.id, false)] }),
        ).rejects.toMatchObject({ code: "REVISION_STALE" });
        await expect(
          calibration.record({
            ...input,
            id: randomUUID(),
            labels: [{ ...label(sample.id), score: 100 }],
          }),
        ).rejects.toThrow();
      });
      it("isolates tenants, rejects missing/tampered assessments and enforces review timing", async () => {
        const sample = await assessment();
        const otherOwner = `other-${owner}`;
        await new Repository(db, otherOwner, now).initialize();
        await expect(
          new CalibrationRepository(db, otherOwner, now).record(dataset([label(sample.id)])),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        for (const reviewedAt of ["2026-09-16T00:00:00.000Z", "2026-10-01T00:00:00.000Z"])
          await expect(
            calibration.record(dataset([{ ...label(sample.id), reviewedAt }])),
          ).rejects.toMatchObject({ code: "STATE_INVALID" });
        await expect(
          calibration.record({
            ...dataset([label(sample.id)]),
            through: "2026-10-02T00:00:00.000Z",
          }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
        await db.query("UPDATE match_assessments SET data='{}' WHERE owner_id=$1 AND id=$2", [
          owner,
          sample.id,
        ]);
        await expect(calibration.record(dataset([label(sample.id)]))).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        expect(
          await db.query("SELECT * FROM calibration_datasets WHERE owner_id=$1", [owner]),
        ).toEqual([]);
      });
      it("refuses duplicate jobs and incompatible model routes atomically", async () => {
        const a = await assessment();
        const b = await assessment(true, 80, null, a.jobId);
        await expect(calibration.record(dataset([label(a.id), label(b.id)]))).rejects.toMatchObject(
          { code: "STATE_INVALID" },
        );
        const c = await assessment(true, 60, "synthetic-other-model");
        await expect(calibration.record(dataset([label(a.id), label(c.id)]))).rejects.toMatchObject(
          { code: "STATE_INVALID" },
        );
        await expect(calibration.record(dataset([label(a.id), label(a.id)]))).rejects.toThrow();
        expect(
          await db.query("SELECT * FROM calibration_datasets WHERE owner_id=$1", [owner]),
        ).toEqual([]);
      });
      it("freezes the reviewed corpus and verifies the stored dataset on every read", async () => {
        const labels = [];
        // Test-only non-synthetic flags exercise refusal/metrics, not live quality evidence.
        for (let index = 0; index < 20; index++)
          labels.push(label((await assessment(false, index < 10 ? 20 : 80)).id, index >= 10));
        const input = dataset(labels);
        const report = await calibration.record(input);
        expect(report).toMatchObject({
          status: "measured",
          sampleSize: 20,
          metrics: { spearmanRankCorrelation: 1, relevanceDiscriminationAuc: 1 },
        });
        await db.query("UPDATE match_assessments SET data='{}' WHERE owner_id=$1", [owner]);
        expect(await calibration.report(input.id)).toEqual(report);
        expect(await calibration.record({ ...input, labels: [...labels].reverse() })).toEqual(
          report,
        );
        const other = new CalibrationRepository(db, `other-${owner}`, now);
        expect(await other.list()).toEqual([]);
        await expect(other.report(input.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await db.query("UPDATE calibration_datasets SET data='{}' WHERE owner_id=$1 AND id=$2", [
          owner,
          input.id,
        ]);
        await expect(calibration.report(input.id)).rejects.toMatchObject({ code: "STATE_INVALID" });
        await expect(calibration.list()).rejects.toMatchObject({ code: "STATE_INVALID" });
        await expect(calibration.record(input)).rejects.toMatchObject({ code: "STATE_INVALID" });
      });
      it("refuses misattributed catalog entries and overflow instead of truncating", async () => {
        const input = dataset([label((await assessment()).id)]);
        await calibration.record(input);
        const stored = (
          await db.query("SELECT data FROM calibration_datasets WHERE owner_id=$1 AND id=$2", [
            owner,
            input.id,
          ])
        )[0];
        const original = JSON.parse(String(stored?.data));
        const changed = JSON.stringify({ ...original, id: randomUUID() });
        await db.query(
          "UPDATE calibration_datasets SET data=$1,sha256=$2 WHERE owner_id=$3 AND id=$4",
          [changed, hash(changed), owner, input.id],
        );
        await expect(calibration.list()).rejects.toMatchObject({ code: "STATE_INVALID" });
        await db.query("DELETE FROM calibration_datasets WHERE owner_id=$1", [owner]);
        await db.transaction(async (tx) => {
          for (let index = 0; index < 1001; index++) {
            const id = randomUUID();
            const data = JSON.stringify({ ...original, id });
            await tx.query(
              "INSERT INTO calibration_datasets(owner_id,id,binding,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)",
              [owner, id, hash(id), data, hash(data), now().toISOString()],
            );
          }
        });
        await expect(calibration.list()).rejects.toMatchObject({ code: "STATE_INVALID" });
      });
    },
  );
}
