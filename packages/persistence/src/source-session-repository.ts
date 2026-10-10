import { randomUUID } from "node:crypto";
import {
  type BrowserSessionState,
  browserSessionSchema,
} from "../../contracts/src/browser-session.js";
import { DomainError } from "../../contracts/src/index.js";
import {
  type SourceSessionInput,
  type SourceSessionSummary,
  sourceSessionInputSchema,
} from "../../contracts/src/source-session.js";
import { VaultCipher, vaultEnvelopeSchema } from "../../security/src/vault.js";
import type { Database, SqlExecutor } from "./database.js";
import { Repository } from "./repository.js";

export class SourceSessionRepository extends Repository {
  private readonly vault: VaultCipher | null;
  constructor(db: Database, ownerId: string, key?: string, clock?: () => Date) {
    super(db, ownerId, clock);
    this.vault = key ? new VaultCipher(key) : null;
  }
  private async readable(tx: SqlExecutor) {
    const control = await this.readControl(tx);
    if (control.stopped || control.restoreBlocked || control.discoveryPaused)
      throw new DomainError(
        "POLICY_REVOKED",
        "Owner-source sessions are blocked by current controls.",
      );
  }
  async store(input: SourceSessionInput) {
    const vault = this.vault;
    if (!vault)
      throw new DomainError("CONFIG_INVALID", "Owner-source sessions require a vault key.");
    const value = sourceSessionInputSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.readable(tx);
      const expiry = Date.parse(value.expiresAt);
      if (
        expiry <= this.clock().getTime() ||
        expiry > this.clock().getTime() + 86400000 ||
        value.session.cookies.some(
          (cookie) => cookie.expires !== -1 && cookie.expires * 1000 <= this.clock().getTime(),
        )
      )
        throw new DomainError(
          "SESSION_EXPIRED",
          "Source session authority must be fresh and bounded to one day.",
        );
      const old = (
        await tx.query("SELECT * FROM owner_source_sessions WHERE owner_id=$1 AND source_id=$2", [
          this.ownerId,
          value.sourceId,
        ])
      )[0];
      if (Number(old?.revision ?? 0) !== value.expectedRevision)
        throw new DomainError(
          "STATE_INVALID",
          "Source session revision changed; reload before replacing it.",
        );
      const secretId = randomUUID();
      const revision = value.expectedRevision + 1;
      const binding = {
        ownerId: this.ownerId,
        secretId,
        purpose: "browser_storage" as const,
        keyVersion: 1,
      };
      const bytes = Buffer.from(
        JSON.stringify({
          sourceId: value.sourceId,
          adapterId: value.adapterId,
          revision,
          expiresAt: value.expiresAt,
          permissionEvidenceSha256: value.permissionEvidenceSha256,
          session: value.session,
          usage: "read_only_discovery",
        }),
      );
      try {
        await tx.query(
          "INSERT INTO vault_secrets(owner_id,id,purpose,key_version,envelope,created_at) VALUES($1,$2,'browser_storage',1,$3,$4)",
          [this.ownerId, secretId, JSON.stringify(vault.seal(bytes, binding)), this.now()],
        );
      } finally {
        bytes.fill(0);
      }
      await tx.query(
        "INSERT INTO owner_source_sessions(owner_id,source_id,adapter_id,origin,revision,state,secret_id,permission_sha256,expires_at,updated_at) VALUES($1,$2,$3,$4,$5,'stored',$6,$7,$8,$9) ON CONFLICT(owner_id,source_id) DO UPDATE SET adapter_id=excluded.adapter_id,origin=excluded.origin,revision=excluded.revision,state='stored',secret_id=excluded.secret_id,permission_sha256=excluded.permission_sha256,expires_at=excluded.expires_at,updated_at=excluded.updated_at",
        [
          this.ownerId,
          value.sourceId,
          value.adapterId,
          value.session.origin,
          revision,
          secretId,
          value.permissionEvidenceSha256,
          value.expiresAt,
          this.now(),
        ],
      );
      if (old?.secret_id)
        await tx.query("DELETE FROM vault_secrets WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          String(old.secret_id),
        ]);
      await this.audit(
        tx,
        value.sourceId,
        "source_session.stored",
        revision,
        { origin: value.session.origin, adapterId: value.adapterId },
        `owner:${this.ownerId}`,
      );
      return { sourceId: value.sourceId, revision };
    });
  }
  async snapshot(): Promise<SourceSessionSummary[]> {
    return (
      await this.db.query(
        "SELECT source_id,adapter_id,origin,revision,state,expires_at,updated_at FROM owner_source_sessions WHERE owner_id=$1 ORDER BY source_id",
        [this.ownerId],
      )
    ).map((row) => ({
      sourceId: String(row.source_id),
      adapterId: String(row.adapter_id),
      origin: String(row.origin),
      revision: Number(row.revision),
      state:
        row.state === "revoked"
          ? "revoked"
          : String(row.expires_at) <= this.now()
            ? "expired"
            : "stored",
      expiresAt: String(row.expires_at),
      updatedAt: String(row.updated_at),
    }));
  }
  async revoke(sourceId: string, expectedRevision: number) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM owner_source_sessions WHERE owner_id=$1 AND source_id=$2", [
          this.ownerId,
          sourceId,
        ])
      )[0];
      if (!row || Number(row.revision) !== expectedRevision)
        throw new DomainError("STATE_INVALID", "Source session revision changed.");
      await tx.query(
        "UPDATE owner_source_sessions SET state='revoked',secret_id=NULL,revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND source_id=$3",
        [this.now(), this.ownerId, sourceId],
      );
      if (row.secret_id)
        await tx.query("DELETE FROM vault_secrets WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          String(row.secret_id),
        ]);
      await this.audit(
        tx,
        sourceId,
        "source_session.revoked",
        expectedRevision + 1,
        {},
        `owner:${this.ownerId}`,
      );
    });
  }
  async read(binding: {
    sourceId: string;
    adapterId: string;
    origin: string;
    revision: number;
    permissionEvidenceSha256: string;
  }): Promise<BrowserSessionState> {
    const vault = this.vault;
    if (!vault)
      throw new DomainError("CONFIG_INVALID", "Owner-source sessions require a vault key.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.readable(tx);
      const row = (
        await tx.query(
          "SELECT s.*,v.envelope,v.key_version FROM owner_source_sessions s JOIN vault_secrets v ON v.owner_id=s.owner_id AND v.id=s.secret_id AND v.purpose='browser_storage' WHERE s.owner_id=$1 AND s.source_id=$2",
          [this.ownerId, binding.sourceId],
        )
      )[0];
      if (
        row?.state !== "stored" ||
        row.adapter_id !== binding.adapterId ||
        row.origin !== binding.origin ||
        Number(row.revision) !== binding.revision ||
        row.permission_sha256 !== binding.permissionEvidenceSha256 ||
        String(row.expires_at) <= this.now()
      )
        throw new DomainError(
          "SESSION_EXPIRED",
          "Source session authority is expired, revoked or differently scoped.",
        );
      const bytes = vault.open(vaultEnvelopeSchema.parse(JSON.parse(String(row.envelope))), {
        ownerId: this.ownerId,
        secretId: String(row.secret_id),
        purpose: "browser_storage",
        keyVersion: Number(row.key_version),
      });
      try {
        const value = JSON.parse(bytes.toString("utf8"));
        if (
          value.sourceId !== binding.sourceId ||
          value.adapterId !== binding.adapterId ||
          value.revision !== binding.revision ||
          value.expiresAt !== row.expires_at ||
          value.permissionEvidenceSha256 !== binding.permissionEvidenceSha256 ||
          value.usage !== "read_only_discovery"
        )
          throw new Error("Changed source binding.");
        const session = browserSessionSchema.parse(value.session);
        sourceSessionInputSchema.parse({
          sourceId: binding.sourceId,
          adapterId: binding.adapterId,
          permissionEvidenceSha256: binding.permissionEvidenceSha256,
          expectedRevision: binding.revision,
          ownedAccount: true,
          expiresAt: value.expiresAt,
          session,
        });
        if (
          session.origin !== binding.origin ||
          session.cookies.some(
            (cookie) => cookie.expires !== -1 && cookie.expires * 1000 <= this.clock().getTime(),
          )
        )
          throw new Error("Expired source cookie.");
        return session;
      } catch {
        throw new DomainError("UNAUTHORIZED", "Source session authentication or structure failed.");
      } finally {
        bytes.fill(0);
      }
    });
  }
}
