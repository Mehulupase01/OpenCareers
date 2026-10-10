import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../../packages/config/src/index.js";
import { DomainError } from "../../../packages/contracts/src/index.js";
import { type GmailProvider, oauthClientSchema } from "../../../packages/email/src/gmail.js";
import { GmailService } from "../../../packages/email/src/service.js";
import { verificationRuleSchema } from "../../../packages/email/src/verification.js";
import { EmailRepository } from "../../../packages/persistence/src/email-repository.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";
import { VerificationRepository } from "../../../packages/persistence/src/verification-repository.js";

export async function emailRoutes(
  app: FastifyInstance,
  config: Config,
  owner: Repository,
  provider?: GmailProvider,
) {
  const repository = new EmailRepository(owner.db, owner.ownerId, config.vaultKey);
  const service = new GmailService(repository, provider);
  const verification = new VerificationRepository(owner.db, owner.ownerId, config.vaultKey);
  app.addHook("onClose", async () => {
    await service.close();
  });
  const privateOnly = () => {
    if (config.profile === "demo")
      throw new DomainError("CONFIG_INVALID", "Gmail access is disabled in demo mode.");
    if (!config.vaultKey)
      throw new DomainError("CONFIG_INVALID", "Gmail access requires a configured vault key.");
  };
  app.get("/v1/email", () => repository.snapshot());
  app.get("/v1/email/verification", () => verification.verificationSnapshot());
  app.post("/v1/email/verification/rules", async (request) => {
    privateOnly();
    await verification.approveRule(verificationRuleSchema.parse(request.body));
    return verification.verificationSnapshot();
  });
  app.delete("/v1/email/verification/rules", async (request) => {
    const input = z
      .object({ employerOrigin: z.url(), pathname: z.string().max(180) })
      .strict()
      .parse(request.body);
    await verification.removeRule(input.employerOrigin, input.pathname);
    return verification.verificationSnapshot();
  });
  app.post("/v1/email/verification/:id/follow", async (request) => {
    privateOnly();
    if (!config.externalSubmissionEnabled)
      throw new DomainError("POLICY_REVOKED", "External account actions are disabled.");
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    return verification.followLink(id);
  });
  app.post("/v1/email/configure", async (request) => {
    privateOnly();
    const input = z
      .object({
        credentialsPath: z.string().min(1).max(4096),
        mailbox: z.email(),
        testing: z.boolean(),
      })
      .strict()
      .parse(request.body);
    if (!isAbsolute(input.credentialsPath))
      throw new DomainError(
        "CONFIG_INVALID",
        "Choose an absolute OAuth desktop credentials JSON path.",
      );
    // Read a bounded local file; never persist its path or expose its contents.
    let client: z.infer<typeof oauthClientSchema>;
    try {
      const file = await open(input.credentialsPath, "r");
      try {
        if (!(await file.stat()).isFile()) throw new Error("Not a file.");
        const bytes = Buffer.alloc(65537);
        try {
          const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
          if (bytesRead > 65536) throw new Error("Too large.");
          const data = z
            .object({
              installed: z
                .object({
                  client_id: z.string(),
                  client_secret: z.string(),
                  auth_uri: z.literal("https://accounts.google.com/o/oauth2/auth"),
                  token_uri: z.literal("https://oauth2.googleapis.com/token"),
                })
                .passthrough(),
            })
            .passthrough()
            .parse(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")));
          client = oauthClientSchema.parse({
            clientId: data.installed.client_id,
            clientSecret: data.installed.client_secret,
          });
        } finally {
          bytes.fill(0);
        }
      } finally {
        await file.close();
      }
    } catch {
      throw new DomainError(
        "CONFIG_INVALID",
        "The local Google OAuth desktop credentials file could not be loaded.",
      );
    }
    await repository.configure(client, input.mailbox, input.testing);
    return repository.snapshot();
  });
  app.post("/v1/email/connect", async () => {
    privateOnly();
    return service.connect();
  });
  app.post("/v1/email/disconnect", async () => {
    await service.disconnect();
    return repository.snapshot();
  });
  app.post("/v1/email/sync", async () => {
    privateOnly();
    return service.sync();
  });
  app.post("/v1/email/reset-scan", async () => {
    privateOnly();
    await repository.resetScan();
    return repository.snapshot();
  });
  app.post("/v1/email/senders", async (request) => {
    privateOnly();
    const input = z
      .object({ employerOrigin: z.url(), senderDomain: z.string().max(253) })
      .strict()
      .parse(request.body);
    await repository.approveSender(input.employerOrigin, input.senderDomain);
    return repository.snapshot();
  });
  app.delete("/v1/email/senders", async (request) => {
    const input = z
      .object({ employerOrigin: z.url(), senderDomain: z.string().max(253) })
      .strict()
      .parse(request.body);
    await repository.removeSender(input.employerOrigin, input.senderDomain);
    return repository.snapshot();
  });
}
