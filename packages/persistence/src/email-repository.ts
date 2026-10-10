import { randomUUID } from "node:crypto";
import { z } from "zod";
import { factSchema } from "../../contracts/src/candidate.js";
import { normalizedJobSchema } from "../../contracts/src/discovery.js";
import { packetContentSchema } from "../../contracts/src/documents.js";
import {
  GMAIL_READ_SCOPE,
  type MailContext,
  type MailMessage,
  type MailSnapshot,
  mailContextSchema,
  mailDomainSchema,
  mailMessageSchema,
} from "../../contracts/src/email.js";
import { DomainError, jobInputSchema } from "../../contracts/src/index.js";
import {
  type EmailReceiptEvidence,
  emailReceiptEvidenceSchema,
} from "../../contracts/src/submission.js";
import { correlateMail, mailHash, recipientHash } from "../../email/src/correlation.js";
import { type GmailTokens, type OAuthClient, oauthClientSchema } from "../../email/src/gmail.js";
import { type VaultBinding, VaultCipher, vaultEnvelopeSchema } from "../../security/src/vault.js";
import type { Database, Row, SqlExecutor } from "./database.js";
import { ExceptionRepository } from "./exception-repository.js";
import { Repository } from "./repository.js";

type ConnectionData = { testing: boolean; mailboxHash: string; reason: string };
export interface MailLease {
  generation: number;
  expiresAt: string;
  state: "connecting" | "refreshing" | "connected";
}
const tokenSchema = z
  .object({
    accessToken: z.string().min(10).max(8192),
    refreshToken: z.string().min(10).max(8192),
    expiresAt: z.iso.datetime(),
    refreshExpiresAt: z.iso.datetime().nullable(),
    mailbox: z.email(),
    scope: z.literal(GMAIL_READ_SCOPE),
    clientHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const readData = (row: Row) => JSON.parse(String(row.data)) as ConnectionData;

export class EmailRepository extends Repository {
  private readonly cipher: VaultCipher | null;
  constructor(db: Database, ownerId: string, key?: string, clock?: () => Date) {
    super(db, ownerId, clock);
    this.cipher = key ? new VaultCipher(key) : null;
  }

  private async seal(tx: SqlExecutor, purpose: VaultBinding["purpose"], value: unknown) {
    if (!this.cipher)
      throw new DomainError("CONFIG_INVALID", "Mailbox workflows require a configured vault key.");
    const id = randomUUID();
    const binding = { ownerId: this.ownerId, secretId: id, purpose, keyVersion: 1 };
    const bytes = Buffer.from(JSON.stringify(value));
    try {
      await tx.query(
        "INSERT INTO vault_secrets(owner_id,id,purpose,key_version,envelope,created_at) VALUES($1,$2,$3,1,$4,$5)",
        [this.ownerId, id, purpose, JSON.stringify(this.cipher.seal(bytes, binding)), this.now()],
      );
    } finally {
      bytes.fill(0);
    }
    return id;
  }

  private async open(
    tx: SqlExecutor,
    id: string,
    purpose: VaultBinding["purpose"],
  ): Promise<unknown> {
    if (!this.cipher)
      throw new DomainError("CONFIG_INVALID", "Mailbox workflows require a configured vault key.");
    const row = (
      await tx.query("SELECT * FROM vault_secrets WHERE owner_id=$1 AND id=$2 AND purpose=$3", [
        this.ownerId,
        id,
        purpose,
      ])
    )[0];
    if (!row)
      throw new DomainError("SESSION_EXPIRED", "Mailbox credentials are unavailable; reconnect.");
    const bytes = this.cipher.open(vaultEnvelopeSchema.parse(JSON.parse(String(row.envelope))), {
      ownerId: this.ownerId,
      secretId: id,
      purpose,
      keyVersion: Number(row.key_version),
    });
    try {
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } finally {
      bytes.fill(0);
    }
  }

  private async active(tx: SqlExecutor) {
    const control = await this.readControl(tx);
    if (control.restoreBlocked || control.stopped)
      throw new DomainError(
        "POLICY_REVOKED",
        "Mailbox activity is blocked by stop or restore controls.",
      );
  }

  async configure(clientInput: OAuthClient, mailbox: string, testing: boolean) {
    const client = oauthClientSchema.parse(clientInput);
    const email = z.email().parse(mailbox).trim().toLowerCase();
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.active(tx);
      const old = (
        await tx.query("SELECT * FROM email_connections WHERE owner_id=$1", [this.ownerId])
      )[0];
      if (old && !["disconnected", "reconnect_required"].includes(String(old.state)))
        throw new DomainError(
          "STATE_INVALID",
          "Disconnect the existing mailbox before changing its client.",
        );
      const secret = await this.seal(tx, "oauth_client", client);
      await tx.query(
        "INSERT INTO email_connections(owner_id,generation,state,client_secret_id,data) VALUES($1,1,'disconnected',$2,$3) ON CONFLICT(owner_id) DO UPDATE SET generation=email_connections.generation+1,state='disconnected',client_secret_id=excluded.client_secret_id,token_secret_id=NULL,data=excluded.data,expires_at=NULL,refresh_expires_at=NULL,lease_until=NULL",
        [
          this.ownerId,
          secret,
          JSON.stringify({
            testing,
            mailboxHash: recipientHash(email),
            reason: "Configured; Gmail consent is required.",
          }),
        ],
      );
      for (const id of [old?.client_secret_id, old?.token_secret_id])
        if (id)
          await tx.query("DELETE FROM vault_secrets WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            id,
          ]);
      await this.audit(
        tx,
        this.ownerId,
        "email.configured",
        Number(old?.generation ?? 0) + 1,
        {},
        `owner:${this.ownerId}`,
      );
    });
  }

  async lease(state: MailLease["state"]): Promise<MailLease> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.active(tx);
      const row = (
        await tx.query("SELECT * FROM email_connections WHERE owner_id=$1", [this.ownerId])
      )[0];
      if (!row?.client_secret_id)
        throw new DomainError("CONFIG_INVALID", "Configure Gmail desktop credentials first.");
      if (row.lease_until && String(row.lease_until) > this.now())
        throw new DomainError("STATE_INVALID", "A mailbox operation is already in progress.");
      if (state !== "connecting" && row.state !== "connected")
        throw new DomainError("SESSION_EXPIRED", "Mailbox authorization requires reconnecting.");
      if (
        state === "connecting" &&
        !["disconnected", "reconnect_required", "connecting", "refreshing"].includes(
          String(row.state),
        )
      )
        throw new DomainError("STATE_INVALID", "Disconnect before reconnecting Gmail.");
      const generation = Number(row.generation) + 1;
      const expiresAt = new Date(
        this.clock().getTime() + (state === "connecting" ? 600000 : 120000),
      ).toISOString();
      await tx.query(
        "UPDATE email_connections SET state=$1,generation=$2,lease_until=$3 WHERE owner_id=$4",
        [state, generation, expiresAt, this.ownerId],
      );
      await this.audit(tx, this.ownerId, `email.${state}`, generation);
      return { generation, expiresAt, state };
    });
  }

  private async assertLease(tx: SqlExecutor, lease: MailLease) {
    await this.active(tx);
    const row = (
      await tx.query(
        "SELECT * FROM email_connections WHERE owner_id=$1 AND generation=$2 AND state=$3 AND lease_until>$4",
        [this.ownerId, lease.generation, lease.state, this.now()],
      )
    )[0];
    if (!row)
      throw new DomainError("SESSION_EXPIRED", "Mailbox operation expired or was disconnected.");
    return row;
  }

  async credentials(lease: MailLease) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = await this.assertLease(tx, lease);
      const client = oauthClientSchema.parse(
        await this.open(tx, String(row.client_secret_id), "oauth_client"),
      );
      const tokens = row.token_secret_id
        ? tokenSchema.parse(await this.open(tx, String(row.token_secret_id), "oauth_token"))
        : null;
      if (
        tokens &&
        (tokens.clientHash !== mailHash(client.clientId) ||
          recipientHash(tokens.mailbox) !== readData(row).mailboxHash)
      )
        throw new DomainError("SESSION_EXPIRED", "Mailbox token binding changed; reconnect.");
      return { client, tokens, ...readData(row) };
    });
  }

  async connected(lease: MailLease, tokens: GmailTokens) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = await this.assertLease(tx, lease);
      if (
        recipientHash(tokens.mailbox) !== readData(row).mailboxHash ||
        Date.parse(tokens.expiresAt) <= this.clock().getTime()
      )
        throw new DomainError(
          "SESSION_EXPIRED",
          "Gmail account or token expiry differs from the configured mailbox.",
        );
      const client = oauthClientSchema.parse(
        await this.open(tx, String(row.client_secret_id), "oauth_client"),
      );
      const secret = await this.seal(
        tx,
        "oauth_token",
        tokenSchema.parse({
          ...tokens,
          scope: GMAIL_READ_SCOPE,
          clientHash: mailHash(client.clientId),
        }),
      );
      const old = row.token_secret_id;
      await tx.query(
        "UPDATE email_connections SET state='connected',token_secret_id=$1,expires_at=$2,refresh_expires_at=$3,lease_until=NULL,data=$4 WHERE owner_id=$5 AND generation=$6",
        [
          secret,
          tokens.expiresAt,
          tokens.refreshExpiresAt,
          JSON.stringify({ ...readData(row), reason: "Gmail read-only access is connected." }),
          this.ownerId,
          lease.generation,
        ],
      );
      if (old)
        await tx.query("DELETE FROM vault_secrets WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          old,
        ]);
      await this.audit(tx, this.ownerId, "email.connected", lease.generation);
    });
  }

  async finishSync(lease: MailLease, complete = true) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = await this.assertLease(tx, lease);
      await tx.query(
        "UPDATE email_connections SET lease_until=NULL,last_sync_at=$1,data=$4 WHERE owner_id=$2 AND generation=$3",
        [
          this.now(),
          this.ownerId,
          lease.generation,
          JSON.stringify({
            ...readData(row),
            reason: complete
              ? "Bounded Gmail scan completed."
              : "Gmail scan reached its limit; acquisition is partial.",
          }),
        ],
      );
    });
  }

  async invalidate(
    lease: MailLease,
    reason: "consent_failed" | "authorization_expired" | "temporarily_unavailable",
  ) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM email_connections WHERE owner_id=$1 AND generation=$2", [
          this.ownerId,
          lease.generation,
        ])
      )[0];
      if (!row) return;
      const retry = reason === "temporarily_unavailable" && lease.state === "connected";
      await tx.query(
        "UPDATE email_connections SET state=$1,lease_until=NULL,token_secret_id=$2,data=$3,generation=generation+1 WHERE owner_id=$4 AND generation=$5",
        [
          retry ? "connected" : "reconnect_required",
          retry ? (row.token_secret_id ?? null) : null,
          JSON.stringify({
            ...readData(row),
            reason: retry
              ? "Gmail is temporarily unavailable; retry later."
              : "Gmail authorization requires reconnecting.",
          }),
          this.ownerId,
          lease.generation,
        ],
      );
      if (!retry && row.token_secret_id)
        await tx.query("DELETE FROM vault_secrets WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          row.token_secret_id,
        ]);
      await this.audit(tx, this.ownerId, "email.paused", lease.generation + 1, { reason });
    });
  }

  async disconnect() {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM email_connections WHERE owner_id=$1", [this.ownerId])
      )[0];
      if (!row) return null;
      let tokens: unknown = null;
      if (row.token_secret_id && this.cipher) {
        try {
          tokens = tokenSchema.parse(
            await this.open(tx, String(row.token_secret_id), "oauth_token"),
          );
        } catch {
          tokens = null;
        }
      }
      await tx.query(
        "UPDATE email_connections SET state='disconnected',token_secret_id=NULL,generation=generation+1,lease_until=NULL,expires_at=NULL,refresh_expires_at=NULL,data=$1 WHERE owner_id=$2",
        [JSON.stringify({ ...readData(row), reason: "Gmail is disconnected." }), this.ownerId],
      );
      if (row.token_secret_id)
        await tx.query("DELETE FROM vault_secrets WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          row.token_secret_id,
        ]);
      await this.audit(
        tx,
        this.ownerId,
        "email.disconnected",
        Number(row.generation) + 1,
        {},
        `owner:${this.ownerId}`,
      );
      return tokens ? tokenSchema.parse(tokens) : null;
    });
  }

  async approveSender(employerOrigin: string, senderDomain: string) {
    const origin = new URL(z.url().parse(employerOrigin));
    if (
      origin.origin !== employerOrigin ||
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.port
    )
      throw new DomainError(
        "CONFIG_INVALID",
        "Sender rules require an exact HTTPS employer origin.",
      );
    const domain = mailDomainSchema.parse(senderDomain.toLowerCase());
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.active(tx);
      await tx.query(
        "INSERT INTO email_sender_rules(owner_id,employer_origin,sender_domain,approved_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,employer_origin,sender_domain) DO NOTHING",
        [this.ownerId, employerOrigin, domain, this.now()],
      );
      await this.audit(
        tx,
        this.ownerId,
        "email.sender_approved",
        1,
        { employerOrigin, senderDomain: domain },
        `owner:${this.ownerId}`,
      );
    });
  }

  async contexts(tx: SqlExecutor = this.db): Promise<MailContext[]> {
    const cutoff = new Date(this.clock().getTime() - 14 * 86400000).toISOString();
    const rules = await tx.query(
      "SELECT employer_origin,sender_domain FROM email_sender_rules WHERE owner_id=$1",
      [this.ownerId],
    );
    const domains = (origin: string) => {
      const host = new URL(origin).hostname;
      return [
        ...new Set([
          ...(mailDomainSchema.safeParse(host).success ? [host] : []),
          ...rules
            .filter((rule) => rule.employer_origin === origin)
            .map((rule) => String(rule.sender_domain)),
        ]),
      ].slice(0, 10);
    };
    const rows = await tx.query(
      "SELECT a.id,a.job_id,t.id AS attempt_id,t.started_at,i.packet_id,i.snapshot,i.sha256,c.content,j.data AS job_data FROM applications a JOIN attempts t ON t.owner_id=a.owner_id AND t.application_id=a.id JOIN intents i ON i.owner_id=t.owner_id AND i.id=t.intent_id JOIN packet_contents c ON c.owner_id=i.owner_id AND c.packet_id=i.packet_id JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE a.owner_id=$1 AND a.state IN ('UNKNOWN','NEEDS_REVIEW','CONFIRMED') AND t.state IN ('UNKNOWN','CONFIRMED') AND t.started_at>=$2 ORDER BY t.started_at DESC,t.id DESC LIMIT 50",
      [this.ownerId, cutoff],
    );
    const output: MailContext[] = [];
    for (const row of rows) {
      if (mailHash(String(row.snapshot)) !== row.sha256) continue;
      const packet = packetContentSchema.parse(JSON.parse(String(row.content)));
      const job = jobInputSchema.parse(JSON.parse(String(row.job_data)));
      const origin = new URL(packet.job.url).origin;
      const senderDomains = domains(origin);
      if (!senderDomains.length) continue;
      const references = new Set([job.requisitionId]);
      const listings = await tx.query(
        "SELECT data FROM discovery_listings WHERE owner_id=$1 AND job_id=$2 LIMIT 10",
        [this.ownerId, row.job_id ?? null],
      );
      for (const listing of listings) {
        const parsed = normalizedJobSchema.safeParse(JSON.parse(String(listing.data)));
        if (!parsed.success || new URL(parsed.data.canonicalUrl).origin !== origin) continue;
        for (const reference of [parsed.data.providerRequisition, parsed.data.postingId])
          if (reference && reference.length >= 3 && reference.length <= 180)
            references.add(reference);
      }
      output.push(
        mailContextSchema.parse({
          id: row.id,
          kind: "application",
          attemptId: row.attempt_id,
          packetId: row.packet_id,
          jobId: row.job_id,
          recipient: packet.cv.identity.email,
          employerOrigin: origin,
          senderDomains,
          role: job.title,
          references: [...references]
            .filter((value) => value.length >= 3 && value.length <= 180)
            .slice(0, 10),
          after: row.started_at,
          before: this.now(),
        }),
      );
    }
    const accounts = await tx.query(
      "SELECT a.id,a.employer_origin,a.identity_email_hash,s.id AS attempt_id,s.started_at,p.data AS profile FROM employer_accounts a JOIN signup_attempts s ON s.owner_id=a.owner_id AND s.account_id=a.id JOIN candidates c ON c.owner_id=a.owner_id AND c.id=a.candidate_id JOIN profile_versions p ON p.owner_id=c.owner_id AND p.id=c.active_profile_id WHERE a.owner_id=$1 AND a.state IN ('needs_verification','unknown') AND s.started_at>=$2 AND s.state IN ('CONFIRMED','UNKNOWN') ORDER BY s.started_at DESC LIMIT 50",
      [this.ownerId, cutoff],
    );
    for (const row of accounts) {
      const fact = z
        .object({ facts: z.array(factSchema) })
        .parse(JSON.parse(String(row.profile)))
        .facts.find((item) => item.value.kind === "identity");
      if (
        fact?.value.kind !== "identity" ||
        recipientHash(fact.value.email) !== row.identity_email_hash
      )
        continue;
      const origin = String(row.employer_origin),
        senderDomains = domains(origin);
      if (!senderDomains.length) continue;
      output.push(
        mailContextSchema.parse({
          id: row.id,
          kind: "account",
          attemptId: row.attempt_id,
          packetId: null,
          jobId: null,
          recipient: fact.value.email,
          employerOrigin: origin,
          senderDomains,
          role: "",
          references: [],
          after: row.started_at,
          before: this.now(),
        }),
      );
    }
    return output.slice(0, 50);
  }

  async removeSender(employerOrigin: string, senderDomain: string) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await tx.query(
        "DELETE FROM email_sender_rules WHERE owner_id=$1 AND employer_origin=$2 AND sender_domain=$3",
        [this.ownerId, employerOrigin, senderDomain],
      );
      await this.audit(
        tx,
        this.ownerId,
        "email.sender_removed",
        1,
        { employerOrigin, senderDomain },
        `owner:${this.ownerId}`,
      );
    });
  }

  async ingest(lease: MailLease, rawMessage: MailMessage) {
    const message = mailMessageSchema.parse(rawMessage);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const connection = await this.assertLease(tx, lease);
      const match = correlateMail(message, await this.contexts(tx));
      if (match.status === "unrelated") return null;
      const mailboxHash = readData(connection).mailboxHash;
      const existing = (
        await tx.query(
          "SELECT id,evidence FROM email_messages WHERE owner_id=$1 AND mailbox_hash=$2 AND provider_message_id=$3",
          [this.ownerId, mailboxHash, message.id],
        )
      )[0];
      if (existing) {
        if (existing.evidence)
          await this.queueReceipt(
            tx,
            emailReceiptEvidenceSchema.parse(JSON.parse(String(existing.evidence))),
          );
        return String(existing.id);
      }
      const id = randomUUID(),
        context = match.context;
      const sha256 = mailHash(JSON.stringify(message));
      const evidence =
        context?.kind === "application" && match.kind === "application_received"
          ? emailReceiptEvidenceSchema.parse({
              kind: "gmail",
              providerMessageId: message.id,
              messageSha256: sha256,
              applicationId: context.id,
              attemptId: context.attemptId,
              jobId: context.jobId,
              receivedAt: message.receivedAt,
              emailHash: recipientHash(context.recipient),
              senderDomain: message.authenticatedDomain,
            })
          : null;
      await tx.query(
        "INSERT INTO email_messages(owner_id,id,mailbox_hash,provider_message_id,sha256,classification,correlation,context_id,context_kind,attempt_id,packet_id,evidence,received_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [
          this.ownerId,
          id,
          mailboxHash,
          message.id,
          sha256,
          match.kind,
          match.status,
          context?.id ?? null,
          context?.kind ?? null,
          context?.attemptId ?? null,
          context?.packetId ?? null,
          evidence ? JSON.stringify(evidence) : null,
          message.receivedAt,
          this.now(),
        ],
      );
      if (context)
        await tx.query(
          "INSERT INTO email_outcome_events(owner_id,message_id,context_id,kind,occurred_at) VALUES($1,$2,$3,$4,$5)",
          [this.ownerId, id, context.id, match.kind, this.now()],
        );
      if (evidence) await this.queueReceipt(tx, evidence);
      await this.audit(tx, id, "email.observed", 1, {
        correlation: match.status,
        classification: match.kind,
        contextId: context?.id ?? null,
      });
      return id;
    });
  }

  private async queueReceipt(tx: SqlExecutor, evidence: EmailReceiptEvidence) {
    const latest = (
      await tx.query(
        "SELECT t.id,t.state,a.state AS application_state FROM attempts t JOIN applications a ON a.owner_id=t.owner_id AND a.id=t.application_id WHERE t.owner_id=$1 AND t.application_id=$2 ORDER BY t.started_at DESC,t.id DESC LIMIT 1",
        [this.ownerId, evidence.applicationId],
      )
    )[0];
    if (
      latest?.id === evidence.attemptId &&
      latest.state === "UNKNOWN" &&
      ["UNKNOWN", "NEEDS_REVIEW"].includes(String(latest.application_state))
    )
      await new ExceptionRepository(this.db, this.ownerId, this.clock).queueReconciliation(
        tx,
        evidence.applicationId,
      );
  }

  async receipt(applicationId: string): Promise<EmailReceiptEvidence | null> {
    const rows = await this.db.query(
      "SELECT evidence FROM email_messages WHERE owner_id=$1 AND context_id=$2 AND context_kind='application' AND correlation='correlated' AND classification='application_received' AND evidence IS NOT NULL ORDER BY received_at DESC LIMIT 1",
      [this.ownerId, applicationId],
    );
    return rows[0] ? emailReceiptEvidenceSchema.parse(JSON.parse(String(rows[0].evidence))) : null;
  }

  async snapshot(): Promise<MailSnapshot> {
    const row = (
      await this.db.query("SELECT * FROM email_connections WHERE owner_id=$1", [this.ownerId])
    )[0];
    const data = row ? readData(row) : null;
    const expired =
      row &&
      ["connecting", "refreshing"].includes(String(row.state)) &&
      (!row.lease_until || String(row.lease_until) <= this.now());
    const messages = await this.db.query(
      "SELECT id,classification,correlation,context_id,received_at FROM email_messages WHERE owner_id=$1 ORDER BY received_at DESC LIMIT 100",
      [this.ownerId],
    );
    const rules = await this.db.query(
      "SELECT employer_origin,sender_domain FROM email_sender_rules WHERE owner_id=$1 ORDER BY employer_origin,sender_domain",
      [this.ownerId],
    );
    return {
      connection: {
        state: expired
          ? "reconnect_required"
          : ((row?.state ?? "unconfigured") as MailSnapshot["connection"]["state"]),
        generation: Number(row?.generation ?? 0),
        testing: data?.testing ?? false,
        expiresAt: row?.expires_at ? String(row.expires_at) : null,
        refreshExpiresAt: row?.refresh_expires_at ? String(row.refresh_expires_at) : null,
        lastSyncAt: row?.last_sync_at ? String(row.last_sync_at) : null,
        reason: expired
          ? "Mailbox operation expired; reconnect."
          : (data?.reason ?? "Gmail is not configured."),
      },
      messages: messages.map((item) => ({
        id: String(item.id),
        kind: item.classification as MailSnapshot["messages"][number]["kind"],
        contextId: item.context_id as string | null,
        correlation: item.correlation as "correlated" | "ambiguous",
        receivedAt: String(item.received_at),
      })),
      senderRules: rules.map((item) => ({
        employerOrigin: String(item.employer_origin),
        senderDomain: String(item.sender_domain),
      })),
    };
  }
}
