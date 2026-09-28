import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type EmployerAccount,
  employerAccountSchema,
  type SignupReceiptEvidence,
  signupReceiptEvidenceSchema,
} from "../../contracts/src/account.js";
import { DomainError } from "../../contracts/src/index.js";
import { VaultCipher, vaultEnvelopeSchema } from "../../security/src/vault.js";
import type { Database, Row, SqlExecutor } from "./database.js";
import { Repository } from "./repository.js";

function exactOrigin(input: string): string {
  const url = new URL(input);
  if (
    url.origin !== input ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))
  )
    throw new DomainError("ORIGIN_DENIED", "Employer account origin is not allowed.");
  return url.origin;
}

const emailDigest = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

function accountFrom(row: Row): EmployerAccount {
  return employerAccountSchema.parse({
    id: row.id,
    candidateId: row.candidate_id,
    employerOrigin: row.employer_origin,
    adapterId: row.adapter_id,
    identityEmailHash: row.identity_email_hash,
    state: row.state,
    hasCredential: Boolean(row.secret_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class AccountRepository extends Repository {
  private readonly vault: VaultCipher;

  constructor(db: Database, ownerId: string, vaultKey: string | undefined, clock?: () => Date) {
    super(db, ownerId, clock);
    if (!vaultKey)
      throw new DomainError("CONFIG_INVALID", "Account workflows require a configured vault key.");
    this.vault = new VaultCipher(vaultKey);
  }

  async prepare(input: {
    candidateId: string;
    employerOrigin: string;
    adapterId: string;
    identityEmail: string;
  }): Promise<EmployerAccount> {
    const origin = exactOrigin(input.employerOrigin);
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(input.adapterId))
      throw new DomainError("CONFIG_INVALID", "Account adapter ID is invalid.");
    const accountId = randomUUID();
    const secretId = randomUUID();
    const password = Buffer.from(randomBytes(24).toString("base64url"), "utf8");
    const binding = {
      ownerId: this.ownerId,
      secretId,
      purpose: "employer_password" as const,
      keyVersion: 1,
    };
    const envelope = this.vault.seal(password, binding);
    try {
      return await this.db.transaction(async (tx) => {
        await this.lockOwner(tx);
        const candidate = (
          await tx.query("SELECT id FROM candidates WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            input.candidateId,
          ])
        )[0];
        if (!candidate)
          throw new DomainError("NOT_FOUND", "Candidate account owner was not found.");
        const existing = (
          await tx.query(
            "SELECT * FROM employer_accounts WHERE owner_id=$1 AND candidate_id=$2 AND employer_origin=$3 AND adapter_id=$4",
            [this.ownerId, input.candidateId, origin, input.adapterId],
          )
        )[0];
        if (existing) return accountFrom(existing);
        await tx.query(
          "INSERT INTO vault_secrets(owner_id,id,purpose,key_version,envelope,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            this.ownerId,
            secretId,
            binding.purpose,
            binding.keyVersion,
            JSON.stringify(envelope),
            this.now(),
          ],
        );
        await tx.query(
          "INSERT INTO employer_accounts(owner_id,id,candidate_id,employer_origin,adapter_id,identity_email_hash,state,secret_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'prepared',$7,$8,$9)",
          [
            this.ownerId,
            accountId,
            input.candidateId,
            origin,
            input.adapterId,
            emailDigest(input.identityEmail),
            secretId,
            this.now(),
            this.now(),
          ],
        );
        await this.audit(tx, accountId, "account.prepared", 1, {
          adapterId: input.adapterId,
          employerOrigin: origin,
        });
        const row = (
          await tx.query("SELECT * FROM employer_accounts WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            accountId,
          ])
        )[0];
        if (!row) throw new DomainError("STORAGE_UNAVAILABLE", "Prepared account was not stored.");
        return accountFrom(row);
      });
    } finally {
      password.fill(0);
    }
  }

  async credential(input: {
    accountId: string;
    employerOrigin: string;
    adapterId: string;
  }): Promise<Buffer> {
    const origin = exactOrigin(input.employerOrigin);
    const row = (
      await this.db.query(
        "SELECT a.secret_id,s.purpose,s.key_version,s.envelope FROM employer_accounts a JOIN vault_secrets s ON s.owner_id=a.owner_id AND s.id=a.secret_id WHERE a.owner_id=$1 AND a.id=$2 AND a.employer_origin=$3 AND a.adapter_id=$4 AND a.state NOT IN ('closed','locked')",
        [this.ownerId, input.accountId, origin, input.adapterId],
      )
    )[0];
    if (!row?.secret_id)
      throw new DomainError("NOT_FOUND", "Usable employer credential not found.");
    return this.vault.open(vaultEnvelopeSchema.parse(JSON.parse(String(row.envelope))), {
      ownerId: this.ownerId,
      secretId: String(row.secret_id),
      purpose: "employer_password",
      keyVersion: Number(row.key_version),
    });
  }

  async snapshot(): Promise<EmployerAccount[]> {
    return (
      await this.db.query(
        "SELECT * FROM employer_accounts WHERE owner_id=$1 ORDER BY updated_at DESC,id DESC",
        [this.ownerId],
      )
    ).map(accountFrom);
  }

  private async assertAccountPolicy(tx: SqlExecutor, candidateId: string) {
    const row = (
      await tx.query(
        "SELECT c.active_authorization_id,a.data,a.effective_at,a.expires_at,a.revoked_at FROM candidates c JOIN authorizations a ON a.owner_id=c.owner_id AND a.id=c.active_authorization_id WHERE c.owner_id=$1 AND c.id=$2",
        [this.ownerId, candidateId],
      )
    )[0];
    const policy = row?.data ? (JSON.parse(String(row.data)) as Record<string, unknown>) : null;
    if (
      !policy?.allowAccountCreation ||
      row?.revoked_at ||
      String(row?.effective_at) > this.now() ||
      String(row?.expires_at) <= this.now()
    )
      throw new DomainError("POLICY_REVOKED", "Account creation is not currently authorized.");
  }

  async beginSignup(accountId: string): Promise<{
    attemptId: string;
    accountId: string;
    fence: number;
    intentSha256: string;
  }> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const account = (
        await tx.query("SELECT * FROM employer_accounts WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          accountId,
        ])
      )[0];
      if (!account) throw new DomainError("NOT_FOUND", "Employer account was not found.");
      await this.assertAccountPolicy(tx, String(account.candidate_id));
      if (account.state !== "prepared")
        throw new DomainError("DUPLICATE_SUSPECTED", "Account signup is not safe to repeat.");
      const prior = await tx.query(
        "SELECT id FROM signup_attempts WHERE owner_id=$1 AND account_id=$2 LIMIT 1",
        [this.ownerId, accountId],
      );
      if (prior.length)
        throw new DomainError("DUPLICATE_SUSPECTED", "A prior signup attempt already exists.");
      const fenceRow = (
        await tx.query(
          "UPDATE owners SET next_fence=next_fence+1 WHERE id=$1 RETURNING next_fence",
          [this.ownerId],
        )
      )[0];
      const fence = Number(fenceRow?.next_fence);
      const attemptId = randomUUID();
      const intentSha256 = createHash("sha256")
        .update(
          JSON.stringify({
            accountId,
            adapterId: account.adapter_id,
            employerOrigin: account.employer_origin,
            fence,
            identityEmailHash: account.identity_email_hash,
          }),
        )
        .digest("hex");
      await tx.query(
        "INSERT INTO signup_attempts(owner_id,id,account_id,state,intent_sha256,fence,started_at) VALUES($1,$2,$3,'INTENT_RECORDED',$4,$5,$6)",
        [this.ownerId, attemptId, accountId, intentSha256, fence, this.now()],
      );
      await this.audit(tx, accountId, "account.signup_intent_recorded", fence, { attemptId });
      return { attemptId, accountId, fence, intentSha256 };
    });
  }

  async authorizeSignup(handle: {
    attemptId: string;
    accountId: string;
    fence: number;
    intentSha256: string;
  }): Promise<{ expiresAt: string }> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query(
          "SELECT s.*,a.candidate_id,a.state AS account_state FROM signup_attempts s JOIN employer_accounts a ON a.owner_id=s.owner_id AND a.id=s.account_id WHERE s.owner_id=$1 AND s.id=$2 AND s.account_id=$3",
          [this.ownerId, handle.attemptId, handle.accountId],
        )
      )[0];
      if (
        row?.state !== "INTENT_RECORDED" ||
        row.account_state !== "prepared" ||
        Number(row.fence) !== handle.fence ||
        row.intent_sha256 !== handle.intentSha256 ||
        row.dispatch_started_at
      )
        throw new DomainError("LEASE_STALE", "Signup dispatch capability is stale.");
      await this.assertAccountPolicy(tx, String(row.candidate_id));
      await tx.query(
        "UPDATE signup_attempts SET state='IN_FLIGHT',dispatch_started_at=$1 WHERE owner_id=$2 AND id=$3 AND state='INTENT_RECORDED'",
        [this.now(), this.ownerId, handle.attemptId],
      );
      await tx.query(
        "UPDATE employer_accounts SET state='signup_in_flight',updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state='prepared'",
        [this.now(), this.ownerId, handle.accountId],
      );
      await this.audit(tx, handle.accountId, "account.signup_dispatch_started", handle.fence, {
        attemptId: handle.attemptId,
      });
      return { expiresAt: new Date(this.clock().getTime() + 10000).toISOString() };
    });
  }

  async confirmSignup(
    handle: { attemptId: string; accountId: string; fence: number; intentSha256: string },
    evidenceInput: SignupReceiptEvidence,
  ): Promise<void> {
    const evidence = signupReceiptEvidenceSchema.parse(evidenceInput);
    await this.finishSignup(handle, "active", "CONFIRMED", evidence);
  }

  async markSignupUnknown(handle: {
    attemptId: string;
    accountId: string;
    fence: number;
    intentSha256: string;
  }): Promise<void> {
    await this.finishSignup(handle, "unknown", "UNKNOWN", null);
  }

  private async finishSignup(
    handle: { attemptId: string; accountId: string; fence: number; intentSha256: string },
    accountState: "active" | "unknown",
    attemptState: "CONFIRMED" | "UNKNOWN",
    evidence: SignupReceiptEvidence | null,
  ) {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query(
          "SELECT s.*,a.employer_origin,a.adapter_id,a.identity_email_hash,a.state AS account_state FROM signup_attempts s JOIN employer_accounts a ON a.owner_id=s.owner_id AND a.id=s.account_id WHERE s.owner_id=$1 AND s.id=$2 AND s.account_id=$3",
          [this.ownerId, handle.attemptId, handle.accountId],
        )
      )[0];
      if (
        row?.state !== "IN_FLIGHT" ||
        row.account_state !== "signup_in_flight" ||
        !row.dispatch_started_at ||
        Number(row.fence) !== handle.fence ||
        row.intent_sha256 !== handle.intentSha256
      )
        throw new DomainError("STATE_INVALID", "A dispatched signup attempt is required.");
      if (
        evidence &&
        (evidence.employerOrigin !== row.employer_origin ||
          evidence.adapterId !== row.adapter_id ||
          evidence.identityEmailHash !== row.identity_email_hash)
      )
        throw new DomainError("RECEIPT_UNCORRELATED", "Signup receipt is not correlated.");
      await tx.query(
        "UPDATE signup_attempts SET state=$1,evidence=$2,ended_at=$3 WHERE owner_id=$4 AND id=$5 AND state='IN_FLIGHT'",
        [
          attemptState,
          evidence ? JSON.stringify(evidence) : null,
          this.now(),
          this.ownerId,
          handle.attemptId,
        ],
      );
      await tx.query(
        "UPDATE employer_accounts SET state=$1,updated_at=$2 WHERE owner_id=$3 AND id=$4 AND state='signup_in_flight'",
        [accountState, this.now(), this.ownerId, handle.accountId],
      );
      await this.audit(tx, handle.accountId, `account.signup_${accountState}`, handle.fence, {
        attemptId: handle.attemptId,
      });
    });
  }
}
