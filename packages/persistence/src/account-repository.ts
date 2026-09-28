import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type EmployerAccount, employerAccountSchema } from "../../contracts/src/account.js";
import { DomainError } from "../../contracts/src/index.js";
import { VaultCipher, vaultEnvelopeSchema } from "../../security/src/vault.js";
import type { Database, Row } from "./database.js";
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
}
