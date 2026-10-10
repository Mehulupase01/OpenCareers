import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { GMAIL_READ_SCOPE } from "../../contracts/src/email.js";
import { DomainError } from "../../contracts/src/index.js";
import type { EmailRepository, MailLease } from "../../persistence/src/email-repository.js";
import { GmailProvider, type GmailTokens } from "./gmail.js";

export class GmailService {
  private flow: { server: Server; timer: ReturnType<typeof setTimeout>; lease: MailLease } | null =
    null;
  constructor(
    private readonly repository: EmailRepository,
    private readonly provider = new GmailProvider(),
  ) {}

  async close() {
    const flow = this.flow;
    this.flow = null;
    if (!flow) return;
    clearTimeout(flow.timer);
    flow.server.closeAllConnections();
    await new Promise<void>((resolve) => flow.server.close(() => resolve()));
    await this.repository.invalidate(flow.lease, "consent_failed");
  }

  async connect() {
    await this.close();
    const lease = await this.repository.lease("connecting");
    const { client, testing } = await this.repository.credentials(lease);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    let redirect = "";
    let consumed = false;
    const server = createServer(async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("X-Content-Type-Options", "nosniff");
      let issued: GmailTokens | null = null;
      try {
        const url = new URL(request.url ?? "/", redirect);
        const received = url.searchParams.get("state") ?? "";
        if (
          request.method !== "GET" ||
          request.headers.host !== new URL(redirect).host ||
          url.pathname !== "/oauth/callback" ||
          received.length !== state.length ||
          !timingSafeEqual(Buffer.from(received), Buffer.from(state)) ||
          consumed
        ) {
          response.writeHead(400);
          response.end("Invalid or expired Gmail callback.");
          return;
        }
        consumed = true;
        const code = url.searchParams.get("code");
        if (!code || code.length > 8192 || url.searchParams.has("error"))
          throw new DomainError("SESSION_EXPIRED", "Gmail consent was declined.");
        issued = await this.provider.exchange(
          client,
          {
            code,
            code_verifier: verifier,
            redirect_uri: redirect,
            grant_type: "authorization_code",
          },
          null,
          testing,
        );
        await this.repository.connected(lease, issued);
        response.end("Gmail read-only access is connected. You may close this tab.");
      } catch {
        if (issued) await this.provider.revoke(issued.refreshToken).catch(() => undefined);
        await this.repository.invalidate(lease, "consent_failed").catch(() => undefined);
        response.writeHead(400);
        response.end("Gmail connection was not completed. Reconnect from OpenCareers.");
      } finally {
        if (consumed) {
          if (this.flow?.server === server) {
            clearTimeout(this.flow.timer);
            this.flow = null;
          }
          server.close();
        }
      }
    });
    server.requestTimeout = 20000;
    server.headersTimeout = 10000;
    server.maxHeadersCount = 30;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No loopback listener.");
      redirect = `http://127.0.0.1:${address.port}/oauth/callback`;
      const timer = setTimeout(() => {
        void this.close().catch(() => undefined);
      }, 600000);
      timer.unref();
      this.flow = { server, timer, lease };
      const query = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: GMAIL_READ_SCOPE,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
        state,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      });
      return {
        authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${query}`,
        expiresAt: lease.expiresAt,
      };
    } catch {
      server.close();
      await this.repository.invalidate(lease, "consent_failed");
      throw new DomainError("CONFIG_INVALID", "Gmail loopback authorization could not start.");
    }
  }

  async disconnect() {
    await this.close();
    // Local authority is revoked before the external revocation request.
    const tokens = await this.repository.disconnect();
    if (tokens) await this.provider.revoke(tokens.refreshToken);
  }

  async sync(signal?: AbortSignal) {
    let snapshot = await this.repository.snapshot();
    if (snapshot.connection.state !== "connected") return { status: "disconnected", observed: 0 };
    if (snapshot.connection.scanPaused) return { status: "needs_review", observed: 0 };
    if (
      !snapshot.connection.expiresAt ||
      Date.parse(snapshot.connection.expiresAt) <= Date.now() + 60000
    ) {
      const lease = await this.repository.lease("refreshing");
      let issued: GmailTokens | null = null;
      try {
        const { client, tokens, testing } = await this.repository.credentials(lease);
        if (
          !tokens ||
          (tokens.refreshExpiresAt && Date.parse(tokens.refreshExpiresAt) <= Date.now())
        )
          throw new DomainError("SESSION_EXPIRED", "Gmail refresh authorization expired.");
        issued = await this.provider.exchange(
          client,
          { grant_type: "refresh_token", refresh_token: tokens.refreshToken },
          tokens,
          testing,
        );
        await this.repository.connected(lease, issued);
      } catch {
        if (issued) await this.provider.revoke(issued.refreshToken).catch(() => undefined);
        await this.repository.invalidate(lease, "authorization_expired");
        return { status: "reconnect_required", observed: 0 };
      }
      snapshot = await this.repository.snapshot();
    }
    const lease = await this.repository.lease("connected");
    let observed = 0;
    try {
      const { tokens } = await this.repository.credentials(lease);
      if (!tokens) throw new DomainError("SESSION_EXPIRED", "Gmail token is unavailable.");
      const plan = await this.repository.scanPlan(lease);
      if (!plan.contexts.length) {
        await this.repository.saveScan(lease, plan.scan);
        await this.repository.finishSync(lease);
        return { status: "idle", observed: 0 };
      }
      const scan = await this.provider.messages(
        tokens.accessToken,
        plan.contexts,
        async (message) => {
          if (await this.repository.ingest(lease, message)) observed++;
        },
        async () => {
          await this.repository.credentials(lease);
        },
        {
          scan: plan.scan,
          save: (scan) => this.repository.saveScan(lease, scan),
          ...(signal ? { signal } : {}),
        },
      );
      await this.repository.finishSync(lease, scan.complete);
      return {
        status: scan.complete
          ? plan.totalContexts > plan.contexts.length
            ? "batch_complete"
            : "synced"
          : "partial",
        observed,
      };
    } catch (error) {
      await this.repository.invalidate(
        lease,
        error instanceof DomainError && error.code === "SESSION_EXPIRED"
          ? "authorization_expired"
          : error instanceof DomainError && error.code !== "RATE_LIMITED"
            ? "scan_needs_review"
            : "temporarily_unavailable",
      );
      return {
        status:
          error instanceof DomainError && error.code === "SESSION_EXPIRED"
            ? "reconnect_required"
            : error instanceof DomainError && error.code !== "RATE_LIMITED"
              ? "needs_review"
              : "retry_later",
        observed,
      };
    }
  }
}
