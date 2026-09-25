import { createHash } from "node:crypto";
import type { ApprovedAnswer } from "../../contracts/src/candidate.js";
import {
  type PacketRequestedAnswer,
  type PacketSnapshot,
  packetContentSchema,
  packetManifestSchema,
} from "../../contracts/src/documents.js";
import { DomainError, type JobInput, jobInputSchema } from "../../contracts/src/index.js";
import { assessmentSchema, type MatchAssessment } from "../../contracts/src/matching.js";
import type { ArtifactStore } from "../../documents/src/artifact-store.js";
import type { PacketGenerationInput } from "../../documents/src/domain.js";
import type { BuiltPacket } from "../../documents/src/factory.js";
import { CandidateRepository } from "./candidate-repository.js";
import type { Row } from "./database.js";
import { Repository } from "./repository.js";

const json = <T>(row: Row, key = "data") => JSON.parse(String(row[key])) as T;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export class DocumentRepository extends Repository {
  async hasValidPacket(assessmentId: string): Promise<boolean> {
    const row = (
      await this.db.query(
        "SELECT 1 AS present FROM packets p JOIN packet_contents c ON c.owner_id=p.owner_id AND c.packet_id=p.id LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE p.owner_id=$1 AND c.assessment_id=$2 AND v.packet_id IS NULL LIMIT 1",
        [this.ownerId, assessmentId],
      )
    )[0];
    return Boolean(row);
  }

  async generationInput(
    applicationId: string,
    assessmentId: string,
    requestedAnswers: PacketRequestedAnswer[],
    asOf: string,
  ): Promise<PacketGenerationInput> {
    const candidate = await new CandidateRepository(this.db, this.ownerId, this.clock).snapshot();
    if (!candidate.profile || !candidate.authorization)
      throw new DomainError("PROFILE_STALE", "An active profile and authorization are required.");
    const row = (
      await this.db.query(
        "SELECT a.id AS application_id,a.job_id,a.state,j.data AS job_data,m.data AS assessment_data FROM applications a JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id JOIN match_assessments m ON m.owner_id=a.owner_id AND m.id=$3 WHERE a.owner_id=$1 AND a.id=$2 AND m.application_id=a.id AND m.job_id=a.job_id",
        [this.ownerId, applicationId, assessmentId],
      )
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Application assessment was not found.");
    if (!["ELIGIBLE", "PREPARING", "PREPARED", "NEEDS_INPUT"].includes(String(row.state)))
      throw new DomainError("STATE_INVALID", "Application is not eligible for packet preparation.");
    const assessment = assessmentSchema.parse(json<MatchAssessment>(row, "assessment_data"));
    if (assessment.profileId !== candidate.profile.id)
      throw new DomainError(
        "PROFILE_STALE",
        "Assessment does not use the active profile revision.",
      );
    return {
      job: jobInputSchema.strip().parse(json<JobInput>(row, "job_data")),
      profile: candidate.profile,
      assessment,
      authorization: candidate.authorization,
      approvedAnswers: candidate.answers as ApprovedAnswer[],
      requestedAnswers,
      asOf,
      generatedAt: this.now(),
    };
  }

  async savePacket(
    packet: BuiltPacket,
    options: { preserveValidAssessment?: boolean } = {},
  ): Promise<PacketSnapshot> {
    const manifest = packetManifestSchema.parse(packet.manifest);
    const content = packetContentSchema.parse(packet.content);
    if (manifest.validation.status === "blocked") {
      const reasons = manifest.validation.issues
        .filter((issue) => issue.severity === "error")
        .slice(0, 5)
        .map((issue) => `${issue.code} at ${issue.path}`)
        .join(", ");
      throw new DomainError(
        "CLAIM_UNSUPPORTED",
        `Blocked packet artifacts cannot be persisted${reasons ? `: ${reasons}.` : "."}`,
      );
    }
    if (hash(JSON.stringify(content)) !== manifest.contentSha256)
      throw new DomainError(
        "CLAIM_UNSUPPORTED",
        "Packet content hash does not match its manifest.",
      );
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const application = (
        await tx.query("SELECT * FROM applications WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          manifest.applicationId,
        ])
      )[0];
      const candidate = (
        await tx.query("SELECT * FROM candidates WHERE owner_id=$1", [this.ownerId])
      )[0];
      if (!application || !candidate)
        throw new DomainError("NOT_FOUND", "Packet application missing.");
      if (
        application.job_id !== manifest.jobId ||
        candidate.active_profile_id !== manifest.profileId ||
        candidate.active_authorization_id !== manifest.authorizationId
      )
        throw new DomainError("PROFILE_STALE", "Packet inputs changed before persistence.");
      const assessment = (
        await tx.query(
          "SELECT id FROM match_assessments WHERE owner_id=$1 AND id=$2 AND application_id=$3 AND profile_id=$4",
          [this.ownerId, manifest.assessmentId, manifest.applicationId, manifest.profileId],
        )
      )[0];
      const authorization = (
        await tx.query(
          "SELECT revision,revoked_at FROM authorizations WHERE owner_id=$1 AND id=$2",
          [this.ownerId, manifest.authorizationId],
        )
      )[0];
      if (
        !assessment ||
        !authorization ||
        Number(authorization.revision) !== manifest.authorizationRevision ||
        authorization.revoked_at
      )
        throw new DomainError("POLICY_REVOKED", "Packet authorization is no longer current.");
      if (options.preserveValidAssessment) {
        const preserved = (
          await tx.query(
            "SELECT p.manifest,c.content FROM packets p JOIN packet_contents c ON c.owner_id=p.owner_id AND c.packet_id=p.id LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE p.owner_id=$1 AND p.application_id=$2 AND c.assessment_id=$3 AND v.packet_id IS NULL ORDER BY p.created_at DESC,p.id DESC LIMIT 1",
            [this.ownerId, manifest.applicationId, manifest.assessmentId],
          )
        )[0];
        if (preserved) {
          const preservedManifest = packetManifestSchema.parse(json(preserved, "manifest"));
          if (
            preservedManifest.profileId === manifest.profileId &&
            preservedManifest.authorizationId === manifest.authorizationId &&
            preservedManifest.authorizationRevision === manifest.authorizationRevision
          )
            return {
              manifest: preservedManifest,
              content: packetContentSchema.parse(json(preserved, "content")),
              valid: true,
              invalidReason: null,
            };
        }
      }
      const existing = (
        await tx.query(
          "SELECT id,sha256 FROM packets WHERE owner_id=$1 AND application_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
          [this.ownerId, manifest.applicationId],
        )
      )[0];
      const manifestJson = JSON.stringify(manifest);
      const packetHash = hash(manifestJson);
      if (existing && existing.sha256 !== packetHash) {
        await tx.query(
          "INSERT INTO packet_validity(owner_id,packet_id,invalidated_at,reason) SELECT owner_id,id,$1,'ARTIFACT_CHANGED' FROM packets WHERE owner_id=$2 AND application_id=$3 ON CONFLICT(owner_id,packet_id) DO NOTHING",
          [this.now(), this.ownerId, manifest.applicationId],
        );
        await tx.query(
          "INSERT INTO intent_validity(owner_id,intent_id,invalidated_at,reason) SELECT owner_id,id,$1,'ARTIFACT_CHANGED' FROM intents WHERE owner_id=$2 AND application_id=$3 ON CONFLICT(owner_id,intent_id) DO NOTHING",
          [this.now(), this.ownerId, manifest.applicationId],
        );
      }
      for (const artifact of manifest.artifacts)
        await tx.query(
          "INSERT INTO artifacts(id,owner_id,sha256,storage_key,mime_type,bytes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,sha256) DO NOTHING",
          [
            artifact.id,
            this.ownerId,
            artifact.sha256,
            artifact.storageKey,
            artifact.mimeType,
            artifact.bytes,
            this.now(),
          ],
        );
      await tx.query(
        "INSERT INTO packets(id,owner_id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,id) DO NOTHING",
        [manifest.id, this.ownerId, manifest.applicationId, manifestJson, packetHash, this.now()],
      );
      await tx.query(
        "INSERT INTO packet_contents(owner_id,packet_id,profile_id,assessment_id,content,validation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,packet_id) DO NOTHING",
        [
          this.ownerId,
          manifest.id,
          manifest.profileId,
          manifest.assessmentId,
          JSON.stringify(content),
          JSON.stringify(manifest.validation),
        ],
      );
      for (const [ordinal, artifact] of manifest.artifacts.entries())
        await tx.query(
          "INSERT INTO packet_artifacts(owner_id,packet_id,artifact_id,kind,filename,ordinal) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,packet_id,kind) DO NOTHING",
          [this.ownerId, manifest.id, artifact.id, artifact.kind, artifact.filename, ordinal],
        );
      await tx.query(
        "UPDATE applications SET state=$1,revision=revision+1,updated_at=$2 WHERE owner_id=$3 AND id=$4",
        [
          manifest.validation.status === "valid" ? "PREPARED" : "NEEDS_INPUT",
          this.now(),
          this.ownerId,
          manifest.applicationId,
        ],
      );
      await this.audit(tx, manifest.id, "packet.prepared", 1, {
        status: manifest.validation.status,
        artifacts: manifest.artifacts.length,
      });
      return { manifest, content, valid: true, invalidReason: null };
    });
  }

  async snapshot(): Promise<PacketSnapshot[]> {
    const rows = await this.db.query(
      "SELECT p.manifest,c.content,v.reason FROM packets p JOIN packet_contents c ON c.owner_id=p.owner_id AND c.packet_id=p.id LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE p.owner_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 100",
      [this.ownerId],
    );
    return rows.map((row) => ({
      manifest: packetManifestSchema.parse(json(row, "manifest")),
      content: packetContentSchema.parse(json(row, "content")),
      valid: !row.reason,
      invalidReason: (row.reason as string | null) ?? null,
    }));
  }

  async artifact(packetId: string, kind: string, store: ArtifactStore) {
    const row = (
      await this.db.query(
        "SELECT a.*,pa.filename FROM packet_artifacts pa JOIN artifacts a ON a.owner_id=pa.owner_id AND a.id=pa.artifact_id LEFT JOIN packet_validity v ON v.owner_id=pa.owner_id AND v.packet_id=pa.packet_id WHERE pa.owner_id=$1 AND pa.packet_id=$2 AND pa.kind=$3 AND v.packet_id IS NULL",
        [this.ownerId, packetId, kind],
      )
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Valid packet artifact not found.");
    try {
      const buffer = await store.read(String(row.storage_key), String(row.sha256));
      return { buffer, mimeType: String(row.mime_type), filename: String(row.filename) };
    } catch (error) {
      await this.invalidate(packetId, "ARTIFACT_HASH_MISMATCH");
      throw error;
    }
  }

  private async invalidate(packetId: string, reason: string) {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const packet = (
        await tx.query("SELECT application_id FROM packets WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          packetId,
        ])
      )[0];
      if (!packet) return;
      await tx.query(
        "INSERT INTO packet_validity(owner_id,packet_id,invalidated_at,reason) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,packet_id) DO NOTHING",
        [this.ownerId, packetId, this.now(), reason],
      );
      await tx.query(
        "INSERT INTO intent_validity(owner_id,intent_id,invalidated_at,reason) SELECT owner_id,id,$1,$2 FROM intents WHERE owner_id=$3 AND packet_id=$4 ON CONFLICT(owner_id,intent_id) DO NOTHING",
        [this.now(), reason, this.ownerId, packetId],
      );
      await tx.query(
        "UPDATE applications SET state='NEEDS_REVIEW',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state NOT IN ('CONFIRMED','HISTORICAL_SUBMITTED','IN_FLIGHT','UNKNOWN')",
        [this.now(), this.ownerId, String(packet.application_id)],
      );
    });
  }
}
