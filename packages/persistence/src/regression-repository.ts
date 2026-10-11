import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { CandidateFact } from "../../contracts/src/candidate.js";
import { DomainError } from "../../contracts/src/index.js";
import {
  compileRegressionFixture,
  parseRegressionFixture,
  regressionFromFactCorrection,
} from "../../security/src/regression-fixture.js";
import type { Row, SqlExecutor } from "./database.js";
import { OwnerScope } from "./owner-scope.js";

const reviewSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["approved", "dismissed"]),
    reviewed: z.literal(true),
  })
  .strict();
function decode(row: Row | undefined) {
  if (!row) throw new DomainError("NOT_FOUND", "Regression proposal not found.");
  const fixture = parseRegressionFixture(JSON.parse(String(row.data)));
  const { schemaVersion: _, ...correction } = fixture;
  const compiled = compileRegressionFixture(correction);
  if (
    compiled.sha256 !== row.sha256 ||
    JSON.stringify(fixture) !== row.data ||
    !["proposed", "approved", "dismissed"].includes(String(row.state))
  )
    throw new DomainError("STATE_INVALID", "Regression evidence integrity failed.");
  return {
    id: String(row.id),
    fixture,
    sha256: compiled.sha256,
    state: String(row.state),
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at,
  };
}
export class RegressionRepository extends OwnerScope {
  // Candidate review owns this transaction and lock. No source text is retained.
  async captureFact(tx: SqlExecutor, before: CandidateFact, after: CandidateFact) {
    if (before.status !== "verified" || !before.reviewedAt) return;
    const correction = regressionFromFactCorrection(before, after);
    if (!correction) return;
    const compiled = compileRegressionFixture(correction);
    const event = createHash("sha256")
      .update(JSON.stringify({ owner: this.ownerId, before, after }))
      .digest("hex");
    const existing = (
      await tx.query("SELECT * FROM regression_proposals WHERE owner_id=$1 AND event_sha256=$2", [
        this.ownerId,
        event,
      ])
    )[0];
    if (existing) {
      decode(existing);
      return;
    }
    const id = randomUUID();
    await tx.query(
      "INSERT INTO regression_proposals(owner_id,id,event_sha256,data,sha256,state,revision,created_at) VALUES($1,$2,$3,$4,$5,'proposed',1,$6)",
      [this.ownerId, id, event, JSON.stringify(compiled.fixture), compiled.sha256, this.now()],
    );
    await this.audit(tx, id, "regression.proposed", 1, { kind: correction.kind }, "owner");
  }
  async list() {
    const rows = await this.db.query(
      "SELECT * FROM regression_proposals WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT 1001",
      [this.ownerId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Regression catalog exceeds its bound.");
    return rows.map(decode);
  }
  async review(id: string, raw: unknown) {
    const input = reviewSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM regression_proposals WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          id,
        ])
      )[0];
      const proposal = decode(row);
      if (proposal.state === input.decision && proposal.revision === input.expectedRevision + 1)
        return proposal;
      if (proposal.revision !== input.expectedRevision)
        throw new DomainError("REVISION_STALE", "Regression revision changed.");
      if (proposal.state !== "proposed")
        throw new DomainError("STATE_INVALID", "Reviewed regression decisions are final.");
      await tx.query(
        "UPDATE regression_proposals SET state=$1,revision=revision+1,reviewed_at=$2 WHERE owner_id=$3 AND id=$4",
        [input.decision, this.now(), this.ownerId, id],
      );
      await this.audit(tx, id, `regression.${input.decision}`, proposal.revision + 1, {}, "owner");
      return decode(
        (
          await tx.query("SELECT * FROM regression_proposals WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            id,
          ])
        )[0],
      );
    });
  }
  async export(id: string) {
    const proposal = decode(
      (
        await this.db.query("SELECT * FROM regression_proposals WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          id,
        ])
      )[0],
    );
    if (proposal.state !== "approved")
      throw new DomainError("POLICY_REVOKED", "Owner approval is required for regression export.");
    return proposal.fixture;
  }
}
