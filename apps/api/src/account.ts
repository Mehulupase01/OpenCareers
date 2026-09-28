import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  commitSignup,
  SignupDefinitiveRejection,
  type SignupRequest,
} from "../../../packages/accounts/src/signup.js";
import type { Config } from "../../../packages/config/src/index.js";
import {
  accountPrepareInputSchema,
  accountSignupInputSchema,
} from "../../../packages/contracts/src/account.js";
import { DomainError, idSchema } from "../../../packages/contracts/src/index.js";
import { AccountRepository } from "../../../packages/persistence/src/account-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

const isLoopback = (origin: string) => new URL(origin).hostname === "127.0.0.1";

export async function accountRoutes(
  app: FastifyInstance,
  config: Config,
  repository: Repository,
  request: SignupRequest = fetch,
) {
  // A private profile may legitimately have no vault key yet. The server must
  // still boot and every route must fail closed with an actionable message.
  const accounts = config.vaultKey
    ? new AccountRepository(repository.db, repository.ownerId, config.vaultKey)
    : null;
  const registry = () => {
    if (!accounts)
      throw new DomainError(
        "CONFIG_INVALID",
        "Account workflows require a configured vault key. Set AUTOPILOT_VAULT_KEY.",
      );
    return accounts;
  };

  app.get("/v1/accounts", () => registry().snapshot());

  app.post("/v1/accounts", async (bodyRequest) => {
    const input = accountPrepareInputSchema.parse(bodyRequest.body);
    return registry().prepare(input);
  });

  app.post("/v1/accounts/:id/signup", async (request_) => {
    const { id } = z.object({ id: idSchema }).parse(request_.params);
    const { identityEmail } = accountSignupInputSchema.parse(request_.body);
    const accountStore = registry();
    const account = (await accountStore.snapshot()).find((item) => item.id === id);
    if (!account) throw new DomainError("NOT_FOUND", "Employer account was not found.");

    // The loopback target is the bundled mock ATS, which is the only employer a
    // demo or default local profile may ever write to. Anything else is an
    // external account creation and stays disabled until the owner enables it.
    if (!isLoopback(account.employerOrigin) && !config.externalSubmissionEnabled)
      throw new DomainError(
        "CONFIG_INVALID",
        "External account creation is disabled. Enable external submission to dispatch this signup.",
      );

    // The plaintext identity is never stored, so the caller supplies it again and
    // it must hash to the identity the account was prepared with. A mismatch is
    // refused before any permit is taken.
    if (
      createHash("sha256").update(identityEmail.trim().toLowerCase()).digest("hex") !==
      account.identityEmailHash
    )
      throw new DomainError("RECEIPT_UNCORRELATED", "Identity email does not match this account.");

    const handle = await accountStore.beginSignup(id);
    const credential = await accountStore.credential({
      accountId: id,
      employerOrigin: account.employerOrigin,
      adapterId: account.adapterId,
    });
    try {
      const evidence = await commitSignup(
        account,
        identityEmail,
        credential,
        () => accountStore.authorizeSignup(handle),
        request,
      );
      await accountStore.confirmSignup(handle, evidence);
      return {
        account: (await accountStore.snapshot()).find((item) => item.id === id),
        evidence,
      };
    } catch (error) {
      if (error instanceof SignupDefinitiveRejection) {
        await accountStore.markSignupUnknown(handle);
        throw new DomainError("STATE_INVALID", "The employer definitively rejected this signup.");
      }
      // A lost response, an expired permit, or an uncorrelated body all leave the
      // external outcome unknown. Record it so a second account can never be
      // created automatically, then surface the uncertainty honestly.
      if (error instanceof DomainError) await accountStore.markSignupUnknown(handle);
      throw error;
    }
  });
}
