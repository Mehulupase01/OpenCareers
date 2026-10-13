import { createHash } from "node:crypto";
import { canonicalHostedGuardSnapshot } from "../../browser/src/hosted-form.js";
import type { FieldPlan, FormSnapshot } from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import {
  hostedOriginApprovalSchema,
  hostedOriginPermissionSchema,
  hostedOriginRevocationSchema,
  hostedOriginSchema,
} from "../../contracts/src/hosted-preparation.js";
import { DomainError } from "../../contracts/src/index.js";
import { CandidateRepository } from "./candidate-repository.js";
import type { Row, SqlExecutor } from "./database.js";
import { OwnerScope } from "./owner-scope.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function decode(row: Row) {
  const permission = hostedOriginPermissionSchema.parse({
    origin: row.origin,
    revision: Number(row.revision),
    state: row.state,
    expiresAt: row.expires_at,
    permissionSha256: row.permission_sha256,
    updatedAt: row.updated_at,
  });
  if (
    permission.permissionSha256 !==
    hash(
      JSON.stringify({
        origin: permission.origin,
        expiresAt: permission.expiresAt,
        publicReadAndLowRiskFillReviewed: true,
      }),
    )
  )
    throw new DomainError("POLICY_REVOKED", "Hosted origin approval failed its integrity check.");
  return permission;
}
export async function assertHostedOriginPermission(
  tx: SqlExecutor,
  ownerId: string,
  origin: string,
  revision: number,
  now: string,
) {
  hostedOriginSchema.parse(origin);
  const row = (
    await tx.query("SELECT * FROM hosted_origin_permissions WHERE owner_id=$1 AND origin=$2", [
      ownerId,
      origin,
    ])
  )[0];
  if (!row)
    throw new DomainError(
      "POLICY_REVOKED",
      "Hosted origin has no owner-reviewed preparation permission.",
    );
  const permission = decode(row);
  if (
    permission.revision !== revision ||
    permission.state !== "active" ||
    Date.parse(permission.expiresAt) <= Date.parse(now)
  )
    throw new DomainError(
      "POLICY_REVOKED",
      "Hosted origin permission changed, expired or was revoked.",
    );
  return permission;
}
export class HostedOriginRepository extends OwnerScope {
  async validatePlan(
    packet: PacketSnapshot,
    permission: { origin: string; revision: number },
    snapshot: FormSnapshot,
    plan: FieldPlan,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await assertHostedOriginPermission(
        tx,
        this.ownerId,
        permission.origin,
        permission.revision,
        this.now(),
      );
      if (
        new URL(snapshot.url).href !== new URL(packet.content.job.url).href ||
        snapshot.origin !== permission.origin ||
        new URL(snapshot.url).origin !== permission.origin ||
        snapshot.jobId !== packet.manifest.jobId
      )
        throw new DomainError(
          "FORM_CHANGED",
          "Hosted form is not bound to the approved packet origin and vacancy.",
        );
      return new CandidateRepository(this.db, this.ownerId, this.clock).validateFormPlanIn(
        tx,
        packet,
        canonicalHostedGuardSnapshot(snapshot),
        plan,
      );
    });
  }
  private assertOwner(actor: string) {
    if (actor !== `owner:${this.ownerId}`)
      throw new DomainError("UNAUTHORIZED", "Origin permission changes require the owner.");
  }
  async list() {
    const rows = await this.db.query(
      "SELECT * FROM hosted_origin_permissions WHERE owner_id=$1 ORDER BY origin LIMIT 1001",
      [this.ownerId],
    );
    if (rows.length > 1000)
      throw new DomainError("STATE_INVALID", "Origin permission catalog exceeds its bound.");
    return rows.map(decode);
  }
  async active(origin: string) {
    hostedOriginSchema.parse(origin);
    const row = (
      await this.db.query(
        "SELECT * FROM hosted_origin_permissions WHERE owner_id=$1 AND origin=$2",
        [this.ownerId, origin],
      )
    )[0];
    if (!row) return null;
    const permission = decode(row);
    return permission.state === "active" &&
      Date.parse(permission.expiresAt) > this.clock().getTime()
      ? permission
      : null;
  }
  async approve(raw: unknown, actor: string) {
    this.assertOwner(actor);
    const input = hostedOriginApprovalSchema.parse(raw);
    const remaining = Date.parse(input.expiresAt) - this.clock().getTime();
    if (remaining <= 0 || remaining > 180 * 86400000)
      throw new DomainError("CONFIG_INVALID", "Origin approval must expire within 180 days.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query(
          "SELECT revision FROM hosted_origin_permissions WHERE owner_id=$1 AND origin=$2",
          [this.ownerId, input.origin],
        )
      )[0];
      const revision = Number(row?.revision ?? 0);
      if (revision !== input.expectedRevision)
        throw new DomainError("REVISION_STALE", "Origin permission changed before approval.");
      if (!row) {
        const count = Number(
          (
            await tx.query(
              "SELECT COUNT(*) AS count FROM hosted_origin_permissions WHERE owner_id=$1",
              [this.ownerId],
            )
          )[0]?.count,
        );
        if (count >= 1000)
          throw new DomainError("STATE_INVALID", "Origin permission catalog exceeds its bound.");
      }
      const permissionSha256 = hash(
        JSON.stringify({
          origin: input.origin,
          expiresAt: input.expiresAt,
          publicReadAndLowRiskFillReviewed: true,
        }),
      );
      await tx.query(
        "INSERT INTO hosted_origin_permissions(owner_id,origin,revision,state,expires_at,permission_sha256,updated_at) VALUES($1,$2,$3,'active',$4,$5,$6) ON CONFLICT(owner_id,origin) DO UPDATE SET revision=excluded.revision,state=excluded.state,expires_at=excluded.expires_at,permission_sha256=excluded.permission_sha256,updated_at=excluded.updated_at",
        [this.ownerId, input.origin, revision + 1, input.expiresAt, permissionSha256, this.now()],
      );
      await this.audit(
        tx,
        hash(input.origin),
        "hosted_origin.approved",
        revision + 1,
        { permissionSha256 },
        actor,
      );
      return assertHostedOriginPermission(tx, this.ownerId, input.origin, revision + 1, this.now());
    });
  }
  async revoke(raw: unknown, actor: string) {
    this.assertOwner(actor);
    const input = hostedOriginRevocationSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM hosted_origin_permissions WHERE owner_id=$1 AND origin=$2", [
          this.ownerId,
          input.origin,
        ])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Origin permission not found.");
      const permission = decode(row);
      if (permission.revision !== input.expectedRevision)
        throw new DomainError("REVISION_STALE", "Origin permission changed before revocation.");
      await tx.query(
        "UPDATE hosted_origin_permissions SET state='revoked',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND origin=$3",
        [this.now(), this.ownerId, input.origin],
      );
      await this.audit(
        tx,
        hash(input.origin),
        "hosted_origin.revoked",
        permission.revision + 1,
        {},
        actor,
      );
      return {
        ...permission,
        state: "revoked" as const,
        revision: permission.revision + 1,
        updatedAt: this.now(),
      };
    });
  }
}
