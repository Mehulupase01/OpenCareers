import { DomainError } from "../../contracts/src/index.js";
import { mailHash } from "../../email/src/correlation.js";
import {
  readVerification,
  type VerificationDescriptor,
  type VerificationRead,
  type VerificationRule,
  validateVerificationUrl,
  verificationDescriptorSchema,
  verificationRuleHash,
  verificationRuleSchema,
  verificationSucceeded,
} from "../../email/src/verification.js";
import type { SqlExecutor } from "./database.js";
import { EmailRepository } from "./email-repository.js";

export class VerificationRepository extends EmailRepository {
  async approveRule(input: VerificationRule) {
    const rule = verificationRuleSchema.parse(input);
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.active(tx);
      await tx.query(
        "INSERT INTO email_verification_rules(owner_id,employer_origin,pathname,data,approved_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,employer_origin,pathname) DO UPDATE SET data=excluded.data,approved_at=excluded.approved_at",
        [this.ownerId, rule.employerOrigin, rule.pathname, JSON.stringify(rule), this.now()],
      );
      await this.audit(
        tx,
        this.ownerId,
        "email.verification_route_approved",
        1,
        { origin: rule.employerOrigin, pathname: rule.pathname },
        `owner:${this.ownerId}`,
      );
    });
  }
  async removeRule(origin: string, pathname: string) {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await tx.query(
        "DELETE FROM email_verification_rules WHERE owner_id=$1 AND employer_origin=$2 AND pathname=$3",
        [this.ownerId, origin, pathname],
      );
      await this.audit(
        tx,
        this.ownerId,
        "email.verification_route_removed",
        1,
        { origin, pathname },
        `owner:${this.ownerId}`,
      );
    });
  }
  async verificationSnapshot() {
    return {
      rules: (
        await this.db.query(
          "SELECT data FROM email_verification_rules WHERE owner_id=$1 ORDER BY employer_origin,pathname",
          [this.ownerId],
        )
      ).map((row) => verificationRuleSchema.parse(JSON.parse(String(row.data)))),
      links: (
        await this.db.query(
          "SELECT id,account_id,state,expires_at FROM email_verification_links WHERE owner_id=$1 ORDER BY expires_at DESC LIMIT 100",
          [this.ownerId],
        )
      ).map((row) => ({
        id: String(row.id),
        accountId: String(row.account_id),
        state: String(row.state),
        expiresAt: String(row.expires_at),
      })),
    };
  }
  private async context(tx: SqlExecutor, id: string, state: "pending" | "in_flight") {
    await this.active(tx);
    const row = (
      await tx.query(
        "SELECT l.*,a.employer_origin,a.identity_email_hash,a.state AS account_state,c.active_authorization_id,p.data AS policy,p.effective_at,p.expires_at AS policy_expires_at,p.revoked_at,m.sha256,m.correlation,m.classification,m.context_id,m.context_kind FROM email_verification_links l JOIN employer_accounts a ON a.owner_id=l.owner_id AND a.id=l.account_id JOIN candidates c ON c.owner_id=a.owner_id AND c.id=a.candidate_id JOIN authorizations p ON p.owner_id=c.owner_id AND p.id=c.active_authorization_id JOIN email_messages m ON m.owner_id=l.owner_id AND m.id=l.message_id WHERE l.owner_id=$1 AND l.id=$2",
        [this.ownerId, id],
      )
    )[0];
    if (
      !row ||
      row.state !== state ||
      String(row.expires_at) <= this.now() ||
      !["needs_verification", "unknown"].includes(String(row.account_state))
    )
      throw new DomainError(
        "STATE_INVALID",
        "A fresh, pending signup verification is required; uncertain links are not replayed.",
      );
    const policy = JSON.parse(String(row.policy)) as { allowAccountCreation?: boolean };
    if (
      policy.allowAccountCreation !== true ||
      row.revoked_at ||
      String(row.effective_at) > this.now() ||
      String(row.policy_expires_at) <= this.now()
    )
      throw new DomainError("POLICY_REVOKED", "Account verification is not currently authorized.");
    const descriptor = verificationDescriptorSchema.parse(
      await this.open(tx, String(row.secret_id), "email_verification"),
    );
    const attempt = (
      await tx.query(
        "SELECT id,state,dispatch_started_at FROM signup_attempts WHERE owner_id=$1 AND account_id=$2 ORDER BY started_at DESC,id DESC LIMIT 1",
        [this.ownerId, descriptor.accountId],
      )
    )[0];
    const url = new URL(descriptor.url);
    const ruleRow = (
      await tx.query(
        "SELECT data FROM email_verification_rules WHERE owner_id=$1 AND employer_origin=$2 AND pathname=$3",
        [this.ownerId, url.origin, url.pathname],
      )
    )[0];
    if (!ruleRow)
      throw new DomainError("ORIGIN_DENIED", "Verification route approval was removed.");
    const rule = verificationRuleSchema.parse(JSON.parse(String(ruleRow.data)));
    validateVerificationUrl(descriptor.url, rule, true);
    if (
      descriptor.accountId !== row.account_id ||
      descriptor.identityEmailHash !== row.identity_email_hash ||
      descriptor.messageSha256 !== row.sha256 ||
      row.correlation !== "correlated" ||
      row.classification !== "verification" ||
      row.context_kind !== "account" ||
      row.context_id !== descriptor.accountId ||
      url.origin !== row.employer_origin ||
      verificationRuleHash(rule) !== descriptor.ruleHash ||
      attempt?.id !== descriptor.signupAttemptId ||
      !attempt.dispatch_started_at ||
      !["CONFIRMED", "UNKNOWN"].includes(String(attempt.state))
    )
      throw new DomainError(
        "RECEIPT_UNCORRELATED",
        "Verification link no longer matches its signup, message or reviewed rule.",
      );
    return { descriptor, rule };
  }
  private async beginLink(id: string) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const context = await this.context(tx, id, "pending");
      const unresolved = await tx.query(
        "SELECT id FROM email_verification_links WHERE owner_id=$1 AND account_id=$2 AND id<>$3 AND state IN ('in_flight','unknown') LIMIT 1",
        [this.ownerId, context.descriptor.accountId, id],
      );
      if (unresolved.length)
        throw new DomainError(
          "DUPLICATE_SUSPECTED",
          "An earlier account verification requires reconciliation.",
        );
      await tx.query(
        "UPDATE email_verification_links SET state='in_flight' WHERE owner_id=$1 AND id=$2 AND state='pending'",
        [this.ownerId, id],
      );
      await this.audit(tx, id, "email.verification_dispatched", 1, {
        accountId: context.descriptor.accountId,
      });
      return context.descriptor;
    });
  }
  private async destination(id: string, descriptor: VerificationDescriptor, url: string) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.context(tx, id, "in_flight");
      const target = new URL(url);
      if (target.origin !== new URL(descriptor.url).origin)
        throw new DomainError("ORIGIN_DENIED", "Verification redirect left the signup origin.");
      const row = (
        await tx.query(
          "SELECT data FROM email_verification_rules WHERE owner_id=$1 AND employer_origin=$2 AND pathname=$3",
          [this.ownerId, target.origin, target.pathname],
        )
      )[0];
      if (!row)
        throw new DomainError("ORIGIN_DENIED", "Verification redirect path has no approval.");
      const rule = verificationRuleSchema.parse(JSON.parse(String(row.data)));
      validateVerificationUrl(url, rule);
      return rule;
    });
  }
  async followLink(
    id: string,
    read: VerificationRead = readVerification,
    signal = AbortSignal.timeout(30000),
  ) {
    const descriptor = await this.beginLink(id);
    try {
      let url = descriptor.url;
      for (let hops = 0; hops <= 3; hops++) {
        signal.throwIfAborted();
        const rule = await this.destination(id, descriptor, url);
        const response = await read(url, signal);
        if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
          if (hops === 3 || response.location.length > 4096)
            throw new DomainError("ORIGIN_DENIED", "Verification redirect limit exceeded.");
          url = new URL(response.location, url).href;
          continue;
        }
        if (
          response.status !== 200 ||
          Buffer.byteLength(response.body) > 65536 ||
          !verificationSucceeded(response.body, rule)
        )
          throw new DomainError("COMMIT_UNKNOWN", "Account verification success was not proven.");
        await this.db.transaction(async (tx) => {
          await this.lockOwner(tx);
          await this.context(tx, id, "in_flight");
          const finalRule = (
            await tx.query(
              "SELECT data FROM email_verification_rules WHERE owner_id=$1 AND employer_origin=$2 AND pathname=$3",
              [this.ownerId, rule.employerOrigin, rule.pathname],
            )
          )[0];
          if (
            !finalRule ||
            verificationRuleHash(
              verificationRuleSchema.parse(JSON.parse(String(finalRule.data))),
            ) !== verificationRuleHash(rule)
          )
            throw new DomainError("POLICY_REVOKED", "Verification redirect approval changed.");
          await tx.query(
            "INSERT INTO email_verification_evidence(owner_id,link_id,response_sha256,rule_sha256,observed_at) VALUES($1,$2,$3,$4,$5)",
            [this.ownerId, id, mailHash(response.body), verificationRuleHash(rule), this.now()],
          );
          await tx.query(
            "UPDATE email_verification_links SET state='verified' WHERE owner_id=$1 AND id=$2",
            [this.ownerId, id],
          );
          await tx.query(
            "UPDATE employer_accounts SET state='active',updated_at=$1 WHERE owner_id=$2 AND id=$3 AND state IN ('needs_verification','unknown')",
            [this.now(), this.ownerId, descriptor.accountId],
          );
          await this.audit(tx, descriptor.accountId, "account.email_verified", 1, { linkId: id });
        });
        return { status: "verified" as const };
      }
      throw new DomainError("COMMIT_UNKNOWN", "Verification outcome is uncertain.");
    } catch {
      await this.db.transaction(async (tx) => {
        await this.lockOwner(tx);
        await tx.query(
          "UPDATE email_verification_links SET state='unknown' WHERE owner_id=$1 AND id=$2 AND state='in_flight'",
          [this.ownerId, id],
        );
        await this.audit(tx, id, "email.verification_unknown", 1);
      });
      throw new DomainError(
        "COMMIT_UNKNOWN",
        "Account verification is unresolved; the link will not be replayed.",
      );
    }
  }
  async followPending(signal?: AbortSignal) {
    const rows = await this.db.query(
      "SELECT id FROM email_verification_links WHERE owner_id=$1 AND state='pending' AND expires_at>$2 ORDER BY expires_at,id LIMIT 5",
      [this.ownerId, this.now()],
    );
    for (const row of rows) {
      if (signal?.aborted) break;
      try {
        await this.followLink(
          String(row.id),
          readVerification,
          signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        );
      } catch {
        /* Pending or unknown links remain explicit; no automatic replay. */
      }
    }
  }
}
