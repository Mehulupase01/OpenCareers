import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  type calibrationCompatibilitySchema,
  calibrationDatasetSchema,
  fixedCalibrationSchema,
} from "../../contracts/src/calibration.js";
import { DomainError, jobInputSchema } from "../../contracts/src/index.js";
import { assessmentSchema } from "../../contracts/src/matching.js";
import { scoreCalibration } from "../../matching/src/score-calibration.js";
import type { Row } from "./database.js";
import { jobIdentity } from "./job-identity.js";
import { OwnerScope } from "./owner-scope.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function readDataset(row: Row, expectedId: string) {
  if (hash(String(row.data)) !== row.sha256)
    throw new DomainError("STATE_INVALID", "Fixed dataset integrity check failed.");
  const dataset = fixedCalibrationSchema.parse(JSON.parse(String(row.data)));
  if (
    dataset.id !== expectedId ||
    (dataset.compatibility && hash(JSON.stringify(dataset.compatibility)) !== dataset.routeSha256)
  )
    throw new DomainError(
      "STATE_INVALID",
      "Fixed dataset compatibility or attribution check failed.",
    );
  return dataset;
}

export class CalibrationRepository extends OwnerScope {
  async list() {
    const rows = await this.db.query(
      "SELECT id,data,sha256 FROM calibration_datasets WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1001",
      [this.ownerId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Dataset catalog exceeds the bounded read size.");
    return rows.map((row) => {
      const dataset = readDataset(row, String(row.id));
      const report = scoreCalibration(dataset);
      return {
        id: dataset.id,
        window: report.window,
        status: report.status,
        sampleSize: report.sampleSize,
        synthetic: report.exclusions.synthetic,
      };
    });
  }
  async record(raw: unknown) {
    const input = calibrationDatasetSchema.parse(raw);
    input.labels.sort((a, b) => a.assessmentId.localeCompare(b.assessmentId));
    const binding = hash(JSON.stringify(input));
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const prior = (
        await tx.query(
          "SELECT binding,data,sha256 FROM calibration_datasets WHERE owner_id=$1 AND id=$2",
          [this.ownerId, input.id],
        )
      )[0];
      if (prior) {
        if (prior.binding !== binding)
          throw new DomainError("REVISION_STALE", "Fixed dataset identity was already used.");
        return scoreCalibration(readDataset(prior, input.id));
      }
      const from = Date.parse(input.from),
        through = Date.parse(input.through);
      if (from > through || through > this.clock().getTime())
        throw new DomainError("STATE_INVALID", "Invalid completed review window.");
      const samples = [];
      const routes = new Set<string>();
      let compatibility: z.infer<typeof calibrationCompatibilitySchema> | undefined;
      const jobs = new Set<string>();
      for (const label of input.labels) {
        const row = (
          await tx.query(
            "SELECT m.data,m.sha256,m.job_id,m.profile_id,j.data AS job_data FROM match_assessments m JOIN jobs j ON j.owner_id=m.owner_id AND j.id=m.job_id WHERE m.owner_id=$1 AND m.id=$2",
            [this.ownerId, label.assessmentId],
          )
        )[0];
        if (!row) throw new DomainError("NOT_FOUND", "Assessment not found.");
        if (hash(String(row.data)) !== row.sha256)
          throw new DomainError("STATE_INVALID", "Assessment integrity check failed.");
        const assessment = assessmentSchema.parse(JSON.parse(String(row.data)));
        const job = jobInputSchema.parse(JSON.parse(String(row.job_data)));
        if (
          assessment.id !== label.assessmentId ||
          assessment.jobId !== row.job_id ||
          job.id !== row.job_id ||
          assessment.profileId !== row.profile_id
        )
          throw new DomainError("STATE_INVALID", "Assessment attribution check failed.");
        const reviewed = Date.parse(label.reviewedAt);
        if (reviewed < from || reviewed > through || reviewed < Date.parse(assessment.createdAt))
          throw new DomainError(
            "STATE_INVALID",
            "Review falls outside its assessment timeline or window.",
          );
        const canonicalJobId = (await jobIdentity(tx, this.ownerId, job.id)).canonical;
        if (jobs.has(canonicalJobId))
          throw new DomainError(
            "STATE_INVALID",
            "Only one reviewed assessment per job is allowed.",
          );
        jobs.add(canonicalJobId);
        const currentCompatibility = {
          modelId: assessment.modelId,
          provider: assessment.provider,
          pipelineVersion: assessment.pipelineVersion ?? null,
          profileId: assessment.profileId,
        };
        compatibility ??= currentCompatibility;
        routes.add(hash(JSON.stringify(currentCompatibility)));
        if (routes.size > 1)
          throw new DomainError(
            "STATE_INVALID",
            "Separate model routes, matching pipelines or profiles require separate fixed datasets.",
          );
        samples.push({
          ...label,
          assessmentSha256: String(row.sha256),
          jobId: canonicalJobId,
          score: assessment.score.total,
          synthetic: job.synthetic,
        });
      }
      const dataset = fixedCalibrationSchema.parse({
        id: input.id,
        from: input.from,
        through: input.through,
        recordedAt: this.now(),
        routeSha256: [...routes][0],
        compatibility,
        samples,
      });
      const data = JSON.stringify(dataset);
      await tx.query(
        "INSERT INTO calibration_datasets(owner_id,id,binding,data,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [this.ownerId, input.id, binding, data, hash(data), dataset.recordedAt],
      );
      await this.audit(
        tx,
        input.id,
        "calibration.dataset_recorded",
        1,
        { samples: samples.length, routeSha256: dataset.routeSha256 },
        "owner",
      );
      return scoreCalibration(dataset);
    });
  }
  async report(id: string) {
    const row = (
      await this.db.query(
        "SELECT data,sha256 FROM calibration_datasets WHERE owner_id=$1 AND id=$2",
        [this.ownerId, id],
      )
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Fixed dataset not found.");
    return scoreCalibration(readDataset(row, id));
  }
}
