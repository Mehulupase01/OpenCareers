import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GMAIL_READ_SCOPE } from "../../packages/contracts/src/email.js";
import { GmailProvider } from "../../packages/email/src/gmail.js";
import { newMailScan } from "../../packages/email/src/scan.js";
import { GmailService } from "../../packages/email/src/service.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { EmailRepository } from "../../packages/persistence/src/email-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} encrypted Gmail authority`,
    () => {
      let db: Database;
      let dir: string;
      let owner: string;
      let now: Date;
      let repository: EmailRepository;
      const key = Buffer.alloc(32, 23).toString("base64");
      const client = {
        clientId: "synthetic-google-client",
        clientSecret: "synthetic-google-secret",
      };
      const tokens = {
        accessToken: "synthetic-access-token",
        refreshToken: "synthetic-refresh-token",
        mailbox: "candidate@example.test",
        expiresAt: "2026-10-10T13:00:00.000Z",
        refreshExpiresAt: "2026-10-17T12:00:00.000Z",
      };
      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-email-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "mail.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `email-${randomUUID()}`;
        await new Repository(db, owner).initialize();
        now = new Date("2026-10-10T12:00:00.000Z");
        repository = new EmailRepository(db, owner, key, () => now);
      });
      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });
      const connect = async () => {
        await repository.configure(client, tokens.mailbox, true);
        const lease = await repository.lease("connecting");
        await repository.connected(lease, tokens);
      };
      it("pauses invalid scans without discarding OAuth and supports explicit owner reset", async () => {
        await connect();
        const lease = await repository.lease("connected");
        await repository.invalidate(lease, "scan_needs_review");
        expect((await repository.snapshot()).connection).toMatchObject({
          state: "connected",
          scanPaused: true,
        });
        let networkCalls = 0;
        const service = new GmailService(
          repository,
          new GmailProvider(async () => {
            networkCalls++;
            throw new Error("Unexpected synthetic request");
          }),
        );
        expect(await service.sync()).toEqual({ status: "needs_review", observed: 0 });
        expect(networkCalls).toBe(0);
        await repository.resetScan();
        expect((await repository.snapshot()).connection.scanPaused).toBe(false);
        await expect(repository.credentials(lease)).rejects.toMatchObject({
          code: "SESSION_EXPIRED",
        });
        const fresh = await repository.lease("connected");
        expect((await repository.credentials(fresh)).tokens?.refreshToken).toBe(
          tokens.refreshToken,
        );
        await repository.finishSync(fresh);
      });
      it("fences active mail acquisition on stop and restore without exposing credentials", async () => {
        await connect();
        const lease = await repository.lease("connected");
        await repository.setControl({ stopped: true });
        await expect(repository.credentials(lease)).rejects.toMatchObject({
          code: "POLICY_REVOKED",
        });
        await repository.setControl({ stopped: false });
        await db.query("UPDATE controls SET data=$1 WHERE owner_id=$2", [
          JSON.stringify({ ...(await repository.getControl()), restoreBlocked: true }),
          owner,
        ]);
        await expect(repository.credentials(lease)).rejects.toMatchObject({
          code: "POLICY_REVOKED",
        });
        await repository.disconnect();
        expect((await repository.snapshot()).connection.state).toBe("disconnected");
      });

      it("is useful when disconnected and stores no plaintext client or token", async () => {
        expect((await repository.snapshot()).connection.state).toBe("unconfigured");
        await connect();
        const serialized = JSON.stringify(
          await db.query("SELECT * FROM vault_secrets WHERE owner_id=$1", [owner]),
        );
        for (const secret of [
          client.clientSecret,
          client.clientId,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.mailbox,
        ])
          expect(serialized).not.toContain(secret);
        const snapshot = JSON.stringify(await repository.snapshot());
        expect(snapshot).not.toContain(tokens.mailbox);
        expect(snapshot).not.toContain(tokens.accessToken);
        expect((await repository.snapshot()).connection.state).toBe("connected");
      });
      it("fences a callback after disconnect and rejects a different Gmail account", async () => {
        await repository.configure(client, tokens.mailbox, false);
        const lease = await repository.lease("connecting");
        await expect(
          repository.connected(lease, { ...tokens, mailbox: "other@example.test" }),
        ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
        await repository.disconnect();
        await expect(repository.connected(lease, tokens)).rejects.toMatchObject({
          code: "SESSION_EXPIRED",
        });
        expect((await repository.snapshot()).connection.state).toBe("disconnected");
      });
      it("allows fresh consent after an expired uncertain refresh but never replays it", async () => {
        await connect();
        const stale = await repository.lease("refreshing");
        now = new Date(now.getTime() + 121000);
        expect((await repository.snapshot()).connection.state).toBe("reconnect_required");
        await expect(repository.lease("refreshing")).rejects.toMatchObject({
          code: "SESSION_EXPIRED",
        });
        const fresh = await repository.lease("connecting");
        await expect(repository.connected(stale, tokens)).rejects.toMatchObject({
          code: "SESSION_EXPIRED",
        });
        await repository.connected(fresh, tokens);
        expect((await repository.snapshot()).connection.state).toBe("connected");
      });
      it("disconnects locally even if the encrypted token cannot be decrypted", async () => {
        await connect();
        const wrongKey = new EmailRepository(
          db,
          owner,
          Buffer.alloc(32, 24).toString("base64"),
          () => now,
        );
        expect(await wrongKey.disconnect()).toBeNull();
        expect((await repository.snapshot()).connection.state).toBe("disconnected");
        expect(
          await db.query(
            "SELECT id FROM vault_secrets WHERE owner_id=$1 AND purpose='oauth_token'",
            [owner],
          ),
        ).toHaveLength(0);
      });
      it("replaces client ciphertext rather than retaining superseded secrets", async () => {
        await repository.configure(client, tokens.mailbox, false);
        await repository.configure(
          { ...client, clientSecret: "replacement-synthetic-secret" },
          tokens.mailbox,
          false,
        );
        expect(
          await db.query("SELECT id FROM vault_secrets WHERE owner_id=$1", [owner]),
        ).toHaveLength(1);
      });
      it("encrypts checkpoints, preserves them through token refresh, and removes them on disconnect", async () => {
        await connect();
        const lease = await repository.lease("connected");
        const scan = newMailScan([
          {
            id: "synthetic-context",
            kind: "application",
            attemptId: "synthetic-attempt",
            packetId: "synthetic-packet",
            jobId: "synthetic-job",
            recipient: tokens.mailbox,
            employerOrigin: "https://careers.example.test",
            senderDomains: ["careers.example.test"],
            role: "Engineer",
            references: ["REQ-123"],
            after: "2026-10-10T11:00:00.000Z",
            before: now.toISOString(),
          },
        ]);
        const entry = scan.entries[0];
        if (!entry) throw new Error("Missing synthetic cursor entry.");
        entry.pageToken = "private-page-token";
        scan.pending = {
          key: entry.key,
          ids: ["private-provider-message-id"],
          nextPageToken: "private-next-page-token",
        };
        await repository.saveScan(lease, scan);
        const serialized = JSON.stringify(
          await db.query("SELECT * FROM vault_secrets WHERE owner_id=$1", [owner]),
        );
        expect(serialized).not.toContain("private-page-token");
        expect(serialized).not.toContain("private-provider-message-id");
        await repository.finishSync(lease, false);
        await repository.connected(await repository.lease("refreshing"), tokens);
        expect(
          await db.query(
            "SELECT id FROM vault_secrets WHERE owner_id=$1 AND purpose='email_scan'",
            [owner],
          ),
        ).toHaveLength(1);
        await repository.disconnect();
        expect(
          await db.query(
            "SELECT id FROM vault_secrets WHERE owner_id=$1 AND purpose='email_scan'",
            [owner],
          ),
        ).toHaveLength(0);
        await expect(repository.saveScan(lease, scan)).rejects.toMatchObject({
          code: "SESSION_EXPIRED",
        });
      });
      it("stores no record or action for unrelated mail", async () => {
        await connect();
        const lease = await repository.lease("connected");
        expect(
          await repository.ingest(lease, {
            id: "unrelated-message",
            receivedAt: now.toISOString(),
            sender: "personal@unrelated.example.test",
            recipients: [tokens.mailbox],
            authenticatedDomain: "unrelated.example.test",
            subject: "Private unrelated subject",
            text: "Private unrelated body",
          }),
        ).toBeNull();
        for (const table of ["email_messages", "email_outcome_events", "tasks"])
          expect(await db.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [owner])).toHaveLength(
            0,
          );
      });
      it("isolates owners and refuses simultaneous mailbox operations", async () => {
        await connect();
        const lease = await repository.lease("connected");
        await expect(repository.lease("connected")).rejects.toMatchObject({
          code: "STATE_INVALID",
        });
        const other = new EmailRepository(db, `other-${owner}`, key, () => now);
        expect((await other.snapshot()).connection.state).toBe("unconfigured");
        await repository.finishSync(lease);
        await repository.lease("connected");
      });
      it("uses loopback PKCE consent, rejects wrong state, and consumes a valid callback once", async () => {
        await repository.configure(client, tokens.mailbox, true);
        let exchanges = 0;
        const provider = new GmailProvider(async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === "/token") {
            exchanges++;
            const body = new URLSearchParams(String(init?.body));
            expect(body.get("grant_type")).toBe("authorization_code");
            expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{64}$/);
            expect(body.get("redirect_uri")).toMatch(
              /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/,
            );
            return new Response(
              JSON.stringify({
                access_token: tokens.accessToken,
                refresh_token: tokens.refreshToken,
                expires_in: 3600,
                scope: GMAIL_READ_SCOPE,
                token_type: "Bearer",
              }),
            );
          }
          return new Response(JSON.stringify({ emailAddress: tokens.mailbox }));
        });
        const service = new GmailService(repository, provider);
        try {
          const flow = await service.connect();
          const authorization = new URL(flow.authorizationUrl);
          expect(authorization.origin).toBe("https://accounts.google.com");
          expect(authorization.searchParams.get("scope")).toBe(GMAIL_READ_SCOPE);
          expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
          const callback = new URL(authorization.searchParams.get("redirect_uri") as string);
          callback.searchParams.set("code", "synthetic-code");
          callback.searchParams.set("state", "wrong-state");
          expect((await fetch(callback)).status).toBe(400);
          expect(exchanges).toBe(0);
          callback.searchParams.set("state", authorization.searchParams.get("state") as string);
          expect((await fetch(callback)).status).toBe(200);
          expect(exchanges).toBe(1);
          expect((await repository.snapshot()).connection.state).toBe("connected");
          await expect(fetch(callback)).rejects.toThrow();
          expect(exchanges).toBe(1);
        } finally {
          await service.close();
        }
      });
    },
  );
}
