import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { allowedHandoffCookie, handoffCapability } from "../../browser/src/handoff-policy.js";
import { dryRunResultSchema } from "../../contracts/src/browser.js";
import {
  type BrowserSessionState,
  browserSessionSchema,
} from "../../contracts/src/browser-session.js";
import { packetManifestSchema } from "../../contracts/src/documents.js";
import { type HandoffSession, handoffSessionSchema } from "../../contracts/src/handoff.js";
import { DomainError } from "../../contracts/src/index.js";
import { VaultCipher, vaultEnvelopeSchema } from "../../security/src/vault.js";
import type { Database, Row, SqlExecutor } from "./database.js";
import { Repository } from "./repository.js";

const tokenHash = (token: string) => createHash("sha256").update(token).digest();
export interface HandoffCreateInput {
  applicationId: string;
  preparationId: string;
  adapterId: string;
  targetFingerprint: string;
  ttlMs?: number;
}

function sessionFrom(row: Row): HandoffSession {
  return handoffSessionSchema.parse({
    id: row.id,
    applicationId: row.application_id,
    preparationId: row.preparation_id,
    adapterId: row.adapter_id,
    targetFingerprint: row.target_fingerprint,
    state: row.state,
    generation: Number(row.generation),
    leaseUntil: row.lease_until,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
}

export class HandoffRepository extends Repository {
  constructor(
    db: Database,
    ownerId: string,
    clock?: () => Date,
    private readonly vaultKey?: string,
  ) {
    super(db, ownerId, clock);
  }

  async create(input: HandoffCreateInput): Promise<{ session: HandoffSession; token: string }> {
    return this.db.transaction((tx) => this.createIn(tx, input));
  }

  async createIn(
    tx: SqlExecutor,
    input: HandoffCreateInput,
  ): Promise<{ session: HandoffSession; token: string }> {
    const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
    if (ttlMs < 60_000 || ttlMs > 15 * 60 * 1000)
      throw new DomainError("CONFIG_INVALID", "Handoff expiry is outside the safe range.");
    if (
      !/^[a-z][a-z0-9-]{0,79}$/.test(input.adapterId) ||
      !/^[a-f0-9]{64}$/.test(input.targetFingerprint)
    )
      throw new DomainError("CONFIG_INVALID", "Handoff adapter binding is invalid.");
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const requestedExpiry = this.clock().getTime() + ttlMs;
    await this.lockOwner(tx);
    const row = (
      await tx.query(
        "SELECT a.state AS application_state,b.status,b.expires_at,b.result FROM applications a JOIN browser_preparations b ON b.owner_id=a.owner_id AND b.application_id=a.id WHERE a.owner_id=$1 AND a.id=$2 AND b.id=$3",
        [this.ownerId, input.applicationId, input.preparationId],
      )
    )[0];
    if (row?.application_state !== "CHALLENGE_REQUIRED" || row.status !== "challenge")
      throw new DomainError("STATE_INVALID", "A current challenge preparation is required.");
    if (row.expires_at && String(row.expires_at) <= this.now())
      throw new DomainError("SESSION_EXPIRED", "Challenge preparation has expired.");
    const result = dryRunResultSchema.parse(JSON.parse(String(row.result)));
    if (
      result.adapter?.id !== input.adapterId ||
      result.adapter.targetFingerprint !== input.targetFingerprint
    )
      throw new DomainError("FORM_CHANGED", "Handoff target does not match preparation.");
    const preparationExpiry = row.expires_at ? Date.parse(String(row.expires_at)) : requestedExpiry;
    const expiresAt = new Date(Math.min(requestedExpiry, preparationExpiry)).toISOString();
    const expired = await tx.query(
      "UPDATE handoff_sessions SET state='expired',lease_owner=NULL,lease_until=NULL WHERE owner_id=$1 AND application_id=$2 AND state IN ('open','claimed','rebuilding') AND expires_at<=$3 RETURNING id,generation",
      [this.ownerId, input.applicationId, this.now()],
    );
    for (const stale of expired)
      await this.audit(tx, String(stale.id), "handoff.expired", Number(stale.generation), {});
    const active = await tx.query(
      "SELECT id FROM handoff_sessions WHERE owner_id=$1 AND application_id=$2 AND state IN ('open','claimed','rebuilding')",
      [this.ownerId, input.applicationId],
    );
    if (active.length) throw new DomainError("STATE_INVALID", "An active handoff already exists.");
    await tx.query(
      "INSERT INTO handoff_sessions(owner_id,id,application_id,preparation_id,adapter_id,target_fingerprint,token_hash,state,generation,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'open',1,$8,$9)",
      [
        this.ownerId,
        id,
        input.applicationId,
        input.preparationId,
        input.adapterId,
        input.targetFingerprint,
        tokenHash(token).toString("hex"),
        expiresAt,
        this.now(),
      ],
    );
    await this.audit(tx, id, "handoff.created", 1, {
      applicationId: input.applicationId,
      adapterId: input.adapterId,
    });
    const session = sessionFrom(
      (
        await tx.query("SELECT * FROM handoff_sessions WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          id,
        ])
      )[0] as Row,
    );
    return { session, token };
  }

  async claimHandoff(
    id: string,
    token: string,
    leaseOwner: string,
    leaseMs = 5 * 60 * 1000,
  ): Promise<HandoffSession> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new DomainError("UNAUTHORIZED", "Handoff token is invalid.");
    if (!/^[a-zA-Z0-9_.:-]{1,180}$/.test(leaseOwner) || leaseMs < 30_000 || leaseMs > 5 * 60 * 1000)
      throw new DomainError("CONFIG_INVALID", "Handoff lease is invalid.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM handoff_sessions WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          id,
        ])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Handoff session was not found.");
      const supplied = tokenHash(token);
      const stored = Buffer.from(String(row.token_hash), "hex");
      if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied))
        throw new DomainError("UNAUTHORIZED", "Handoff token is invalid.");
      if (row.state !== "open" || String(row.expires_at) <= this.now())
        throw new DomainError("SESSION_EXPIRED", "Handoff session is not claimable.");
      const leaseUntil = new Date(
        Math.min(this.clock().getTime() + leaseMs, Date.parse(String(row.expires_at))),
      ).toISOString();
      await tx.query(
        "UPDATE handoff_sessions SET state='claimed',lease_owner=$1,lease_until=$2 WHERE owner_id=$3 AND id=$4 AND state='open'",
        [leaseOwner, leaseUntil, this.ownerId, id],
      );
      await this.audit(tx, id, "handoff.claimed", Number(row.generation), { leaseOwner });
      return sessionFrom({
        ...row,
        state: "claimed",
        lease_owner: leaseOwner,
        lease_until: leaseUntil,
      });
    });
  }

  async completeHandoff(
    id: string,
    leaseOwner: string,
    generation: number,
    browserSession?: BrowserSessionState,
  ): Promise<HandoffSession> {
    if (
      !/^[a-zA-Z0-9_.:-]{1,180}$/.test(leaseOwner) ||
      !Number.isInteger(generation) ||
      generation < 1
    )
      throw new DomainError("CONFIG_INVALID", "Handoff completion identity is invalid.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM handoff_sessions WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          id,
        ])
      )[0];
      if (
        row?.state !== "claimed" ||
        row.lease_owner !== leaseOwner ||
        Number(row.generation) !== generation ||
        !row.lease_until ||
        String(row.lease_until) <= this.now() ||
        String(row.expires_at) <= this.now()
      )
        throw new DomainError("LEASE_STALE", "Handoff lease is stale.");
      const nextGeneration = generation + 1;
      if (browserSession) {
        if (!this.vaultKey)
          throw new DomainError(
            "CONFIG_INVALID",
            "Encrypted browser continuation requires a vault key.",
          );
        const state = browserSessionSchema.parse(browserSession);
        const bound = (
          await tx.query(
            "SELECT b.result,p.manifest,c.active_profile_id,c.active_authorization_id,u.revision,u.revoked_at,u.expires_at,a.state FROM browser_preparations b JOIN packets p ON p.owner_id=b.owner_id AND p.id=b.packet_id JOIN applications a ON a.owner_id=b.owner_id AND a.id=b.application_id JOIN candidates c ON c.owner_id=a.owner_id AND c.id=a.candidate_id JOIN authorizations u ON u.owner_id=c.owner_id AND u.id=c.active_authorization_id LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE b.owner_id=$1 AND b.id=$2 AND v.packet_id IS NULL",
            [this.ownerId, row.preparation_id ?? null],
          )
        )[0];
        if (
          bound?.state !== "CHALLENGE_REQUIRED" ||
          bound.revoked_at ||
          String(bound.expires_at) <= this.now() ||
          (await this.readControl(tx)).restoreBlocked
        )
          throw new DomainError("PROFILE_STALE", "Handoff inputs changed before continuation.");
        const manifest = packetManifestSchema.parse(JSON.parse(String(bound.manifest)));
        const prepared = dryRunResultSchema.parse(JSON.parse(String(bound.result)));
        const origin = new URL(state.origin);
        const original = new URL(prepared.snapshots[0]?.url ?? "");
        const capability = handoffCapability(String(row.adapter_id));
        if (
          !capability ||
          state.origin !== origin.origin ||
          (capability.navigation === "fixture-server"
            ? origin.protocol !== "http:" || origin.hostname !== "127.0.0.1"
            : origin.origin !== original.origin) ||
          state.cookies.some(
            (cookie) =>
              !allowedHandoffCookie(capability, cookie.name) ||
              cookie.domain.replace(/^\./, "") !== origin.hostname ||
              /[\r\n;]/.test(cookie.value),
          )
        )
          throw new DomainError(
            "ORIGIN_DENIED",
            "Continuation contains unreviewed or off-origin session state.",
          );
        if (
          manifest.profileId !== bound.active_profile_id ||
          manifest.authorizationId !== bound.active_authorization_id ||
          manifest.authorizationRevision !== Number(bound.revision)
        )
          throw new DomainError(
            "PROFILE_STALE",
            "Handoff continuation requires the active profile and authorization.",
          );
        const prior = await tx.query(
          "SELECT id FROM attempts WHERE owner_id=$1 AND application_id=$2 AND (state<>'BLOCKED_BEFORE_DISPATCH' OR dispatch_started_at IS NOT NULL) LIMIT 1",
          [this.ownerId, row.application_id ?? null],
        );
        if (prior.length)
          throw new DomainError(
            "DUPLICATE_SUSPECTED",
            "Reconcile the previous action before resuming a browser.",
          );
        const secretId = randomUUID();
        const payload = Buffer.from(
          JSON.stringify({
            session: state,
            handoffId: id,
            generation: nextGeneration,
            applicationId: row.application_id,
            adapterId: row.adapter_id,
            targetFingerprint: row.target_fingerprint,
            packetId: manifest.id,
            profileId: manifest.profileId,
            authorizationId: manifest.authorizationId,
            authorizationRevision: manifest.authorizationRevision,
            expiresAt: row.expires_at,
          }),
        );
        try {
          const envelope = new VaultCipher(this.vaultKey).seal(payload, {
            ownerId: this.ownerId,
            secretId,
            purpose: "browser_storage",
            keyVersion: 1,
          });
          await tx.query(
            "INSERT INTO vault_secrets(owner_id,id,purpose,key_version,envelope,created_at) VALUES($1,$2,'browser_storage',1,$3,$4)",
            [this.ownerId, secretId, JSON.stringify(envelope), this.now()],
          );
          await tx.query(
            "INSERT INTO handoff_continuations(owner_id,handoff_id,secret_id,generation,packet_id,profile_id,authorization_id,authorization_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              this.ownerId,
              id,
              secretId,
              nextGeneration,
              manifest.id,
              manifest.profileId,
              manifest.authorizationId,
              manifest.authorizationRevision,
              row.expires_at ?? null,
            ],
          );
        } finally {
          payload.fill(0);
        }
        await this.enqueueIn(tx, {
          type: "inspect",
          domain: "browser",
          applicationId: String(row.application_id),
          dedupeKey: `inspect:handoff:${id}:${nextGeneration}`,
          payload: { schemaVersion: 1, packetId: manifest.id, handoffId: id },
        });
      }
      await tx.query(
        "UPDATE handoff_sessions SET state='rebuilding',generation=$1,lease_owner=NULL,lease_until=NULL,completed_at=$2 WHERE owner_id=$3 AND id=$4 AND state='claimed'",
        [nextGeneration, this.now(), this.ownerId, id],
      );
      await tx.query(
        "UPDATE browser_preparations SET resolved_at=$1 WHERE owner_id=$2 AND id=$3 AND resolved_at IS NULL",
        [this.now(), this.ownerId, String(row.preparation_id)],
      );
      await this.audit(tx, id, "handoff.challenge_completed", nextGeneration, {});
      return sessionFrom({
        ...row,
        state: "rebuilding",
        generation: nextGeneration,
        lease_owner: null,
        lease_until: null,
        completed_at: this.now(),
      });
    });
  }

  async cancelClaim(id: string, leaseOwner: string, generation: number): Promise<void> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const rows = await tx.query(
        "UPDATE handoff_sessions SET state='cancelled',generation=generation+1,lease_owner=NULL,lease_until=NULL WHERE owner_id=$1 AND id=$2 AND state='claimed' AND lease_owner=$3 AND generation=$4 RETURNING generation",
        [this.ownerId, id, leaseOwner, generation],
      );
      if (!rows[0]) throw new DomainError("LEASE_STALE", "Handoff lease is stale.");
      await this.audit(tx, id, "handoff.cancelled", Number(rows[0].generation), {});
    });
  }

  async continuation(
    id: string,
    applicationId: string,
    packetId: string,
  ): Promise<BrowserSessionState> {
    if (!this.vaultKey)
      throw new DomainError("CONFIG_INVALID", "Browser continuation requires a vault key.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query(
          "SELECT h.adapter_id,h.target_fingerprint,h.application_id,h.generation AS session_generation,h.expires_at AS session_expiry,h.state,k.*,s.envelope,s.key_version,c.active_profile_id,c.active_authorization_id,u.revision,u.revoked_at,u.expires_at AS authorization_expiry FROM handoff_sessions h JOIN handoff_continuations k ON k.owner_id=h.owner_id AND k.handoff_id=h.id JOIN vault_secrets s ON s.owner_id=k.owner_id AND s.id=k.secret_id JOIN applications a ON a.owner_id=h.owner_id AND a.id=h.application_id JOIN candidates c ON c.owner_id=a.owner_id AND c.id=a.candidate_id JOIN authorizations u ON u.owner_id=c.owner_id AND u.id=c.active_authorization_id LEFT JOIN packet_validity v ON v.owner_id=k.owner_id AND v.packet_id=k.packet_id WHERE h.owner_id=$1 AND h.id=$2 AND h.application_id=$3 AND k.packet_id=$4 AND v.packet_id IS NULL",
          [this.ownerId, id, applicationId, packetId],
        )
      )[0];
      if (
        !row ||
        row.generation !== row.session_generation ||
        row.expires_at !== row.session_expiry ||
        !["rebuilding", "completed"].includes(String(row.state)) ||
        String(row.expires_at) <= this.now() ||
        row.revoked_at ||
        String(row.authorization_expiry) <= this.now() ||
        row.profile_id !== row.active_profile_id ||
        row.authorization_id !== row.active_authorization_id ||
        Number(row.authorization_revision) !== Number(row.revision) ||
        (await this.readControl(tx)).restoreBlocked
      )
        throw new DomainError("SESSION_EXPIRED", "Browser continuation is stale or revoked.");
      const plaintext = new VaultCipher(this.vaultKey as string).open(
        vaultEnvelopeSchema.parse(JSON.parse(String(row.envelope))),
        {
          ownerId: this.ownerId,
          secretId: String(row.secret_id),
          purpose: "browser_storage",
          keyVersion: Number(row.key_version),
        },
      );
      try {
        const payload = JSON.parse(plaintext.toString("utf8"));
        if (
          payload.handoffId !== id ||
          payload.generation !== Number(row.generation) ||
          payload.applicationId !== applicationId ||
          payload.adapterId !== row.adapter_id ||
          payload.targetFingerprint !== row.target_fingerprint ||
          payload.packetId !== packetId ||
          payload.profileId !== row.profile_id ||
          payload.authorizationId !== row.authorization_id ||
          payload.authorizationRevision !== Number(row.authorization_revision) ||
          payload.expiresAt !== row.expires_at
        )
          throw new DomainError("UNAUTHORIZED", "Browser continuation binding changed.");
        return browserSessionSchema.parse(payload.session);
      } catch {
        throw new DomainError(
          "UNAUTHORIZED",
          "Browser continuation authentication or structure failed.",
        );
      } finally {
        plaintext.fill(0);
      }
    });
  }

  async target(
    id: string,
  ): Promise<{ session: HandoffSession; result: ReturnType<typeof dryRunResultSchema.parse> }> {
    const row = (
      await this.db.query(
        "SELECT h.*,b.result FROM handoff_sessions h JOIN browser_preparations b ON b.owner_id=h.owner_id AND b.id=h.preparation_id WHERE h.owner_id=$1 AND h.id=$2",
        [this.ownerId, id],
      )
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Handoff session was not found.");
    const session = sessionFrom(row);
    const result = dryRunResultSchema.parse(JSON.parse(String(row.result)));
    if (
      result.adapter?.id !== session.adapterId ||
      result.adapter.targetFingerprint !== session.targetFingerprint ||
      result.applicationId !== session.applicationId
    )
      throw new DomainError("FORM_CHANGED", "Handoff target no longer matches its preparation.");
    return { session, result };
  }

  async snapshot(): Promise<HandoffSession[]> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const expired = await tx.query(
        "UPDATE handoff_sessions SET state='expired',lease_owner=NULL,lease_until=NULL WHERE owner_id=$1 AND state IN ('open','claimed','rebuilding') AND expires_at<=$2 RETURNING id,generation",
        [this.ownerId, this.now()],
      );
      for (const stale of expired)
        await this.audit(tx, String(stale.id), "handoff.expired", Number(stale.generation), {});
      return (
        await tx.query(
          "SELECT * FROM handoff_sessions WHERE owner_id=$1 ORDER BY created_at DESC,id DESC",
          [this.ownerId],
        )
      ).map(sessionFrom);
    });
  }
}
