import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import type { Config } from "../../../packages/config/src/index.js";
import { DomainError, VERSION } from "../../../packages/contracts/src/index.js";
import type { Repository } from "../../../packages/persistence/src/repository.js";

export async function buildServer(config: Config, repository: Repository) {
  const app = Fastify({
    logger: false,
    bodyLimit: 128 * 1024,
    requestTimeout: 30000,
    trustProxy: false,
  });
  await app.register(cookie);
  const sessions = new Map<string, number>();
  const loginAttempts = new Map<string, { count: number; until: number }>();
  const allowedHosts = new Set(config.allowedOrigins.map((origin) => new URL(origin).host));
  allowedHosts.add(`${config.host}:${config.port}`);
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const validToken = (value: string) =>
    Boolean(config.ownerToken && timingSafeEqual(digest(value), digest(config.ownerToken)));

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (!allowedHosts.has(request.headers.host ?? ""))
      throw new DomainError("ORIGIN_DENIED", "Unrecognized request host.");
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin))
      throw new DomainError("ORIGIN_DENIED", "Unrecognized request origin.");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !origin &&
      !request.headers.authorization
    )
      throw new DomainError(
        "ORIGIN_DENIED",
        "State changes require a trusted origin or authenticated API request.",
      );
    if (!request.url.startsWith("/v1/") || request.url.split("?")[0] === "/v1/session") return;
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    const session = request.cookies.opencareers;
    if ((token && validToken(token)) || (session && (sessions.get(session) ?? 0) > Date.now()))
      return;
    throw new DomainError("UNAUTHORIZED", "Owner authentication required.");
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        code: "CONFIG_INVALID",
        message: "Invalid request fields.",
        correlationId: _request.id,
      });
    if (error instanceof DomainError) {
      const status =
        error.code === "UNAUTHORIZED"
          ? 401
          : error.code === "ORIGIN_DENIED"
            ? 403
            : error.code === "NOT_FOUND"
              ? 404
              : error.code === "RATE_LIMITED"
                ? 429
                : 409;
      return reply
        .code(status)
        .send({ code: error.code, message: error.message, correlationId: _request.id });
    }
    return reply.code(503).send({
      code: "STORAGE_UNAVAILABLE",
      message: "The operation could not be completed.",
      correlationId: _request.id,
    });
  });

  app.get("/health/live", async () => ({
    status: "alive",
    version: VERSION,
    profile: config.profile,
  }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await repository.db.query(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
      );
      return { status: "ready", version: VERSION, profile: config.profile };
    } catch {
      return reply.code(503).send({ status: "unavailable", code: "STORAGE_UNAVAILABLE" });
    }
  });
  app.post("/v1/session", async (request, reply) => {
    const body = z
      .object({ token: z.string().max(1024).optional() })
      .strict()
      .parse(request.body);
    const now = Date.now();
    for (const [key, expiration] of sessions) if (expiration <= now) sessions.delete(key);
    for (const [key, attempt] of loginAttempts) if (attempt.until <= now) loginAttempts.delete(key);
    const attempts = loginAttempts.get(request.ip) ?? { count: 0, until: now + 60000 };
    if (attempts.count >= 10 || sessions.size >= 100 || loginAttempts.size >= 1000)
      throw new DomainError("RATE_LIMITED", "Too many sign-in attempts. Try again later.");
    attempts.count += 1;
    loginAttempts.set(request.ip, attempts);
    if (config.profile !== "demo" && !validToken(body.token ?? ""))
      throw new DomainError("UNAUTHORIZED", "Invalid owner token.");
    const token = randomBytes(32).toString("hex");
    sessions.set(token, now + 8 * 60 * 60 * 1000);
    reply.setCookie("opencareers", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.profile === "server",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return { profile: config.profile, version: VERSION };
  });
  app.delete("/v1/session", async (request, reply) => {
    if (request.cookies.opencareers) sessions.delete(request.cookies.opencareers);
    reply.clearCookie("opencareers", { path: "/" });
    return { status: "signed_out" };
  });
  app.get("/v1/operations/summary", () => repository.summary(config.profile));
  app.post("/v1/control/pause", async (request) => {
    const body = z
      .object({ stage: z.enum(["discovery", "preparation", "submissions"]), paused: z.boolean() })
      .strict()
      .parse(request.body);
    return repository.setControl({ [`${body.stage}Paused`]: body.paused });
  });
  app.post("/v1/control/stop", () =>
    repository.setControl({ stopped: true, submissionsPaused: true }),
  );
  app.post("/v1/control/resume", () => repository.setControl({ stopped: false }));
  app.post("/v1/demo/probe", async () => {
    if (config.profile !== "demo") throw new DomainError("NOT_FOUND", "Demo command unavailable.");
    return repository.enqueue({
      type: "demo_probe",
      domain: "internal",
      dedupeKey: `probe:${randomBytes(12).toString("hex")}`,
    });
  });

  const webRoot = resolve(process.cwd(), "dist/web");
  if (existsSync(webRoot)) {
    await app.register(staticFiles, { root: webRoot, prefix: "/" });
  }
  return app;
}
