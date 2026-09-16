import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";

const envSchema = z.object({
  AUTOPILOT_PROFILE: z.enum(["demo", "local", "server"]).default("demo"),
  AUTOPILOT_HOST: z.string().default("127.0.0.1"),
  AUTOPILOT_PORT: z.coerce.number().int().min(1024).max(65535).default(4317),
  AUTOPILOT_DATA_DIR: z.string().optional(),
  AUTOPILOT_OWNER_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_.:-]+$/)
    .default("local-owner"),
  AUTOPILOT_OWNER_TOKEN: z.string().min(32).optional(),
  AUTOPILOT_DATABASE_URL: z.string().optional(),
  AUTOPILOT_ALLOWED_ORIGINS: z.string().optional(),
});

export interface Config {
  profile: "demo" | "local" | "server";
  host: string;
  port: number;
  dataDir: string;
  ownerId: string;
  ownerToken: string | undefined;
  databaseUrl: string | undefined;
  allowedOrigins: string[];
  externalSubmissionEnabled: false;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new DomainError(
      "CONFIG_INVALID",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  const e = parsed.data;
  const profile = e.AUTOPILOT_PROFILE;
  const dataDir = resolve(e.AUTOPILOT_DATA_DIR ?? resolve(cwd, ".data/demo"));
  if (profile !== "server" && !["127.0.0.1", "::1"].includes(e.AUTOPILOT_HOST)) {
    throw new DomainError("CONFIG_INVALID", "Demo and local profiles must bind to loopback.");
  }
  if (profile === "demo" && dataDir !== resolve(cwd, ".data/demo")) {
    throw new DomainError(
      "CONFIG_INVALID",
      "Demo data must use the repository .data/demo directory.",
    );
  }
  if (profile !== "demo" && (!e.AUTOPILOT_DATA_DIR || !e.AUTOPILOT_OWNER_TOKEN)) {
    throw new DomainError(
      "CONFIG_INVALID",
      "Private profiles require AUTOPILOT_DATA_DIR and a 32+ character owner token.",
    );
  }
  if (profile !== "demo") {
    const inside = relative(resolve(cwd), dataDir);
    if (!inside || (!inside.startsWith("..") && !isAbsolute(inside))) {
      throw new DomainError("CONFIG_INVALID", "Private data must be outside the repository.");
    }
  }
  if (
    /(?:^|[\\/])(?:onedrive[^\\/]*|dropbox|google drive)(?:[\\/]|$)/i.test(dataDir) ||
    dataDir.startsWith("\\\\")
  ) {
    throw new DomainError("CONFIG_INVALID", "Use a non-synced local data directory.");
  }
  if (profile === "server" && !e.AUTOPILOT_DATABASE_URL?.startsWith("postgresql://")) {
    throw new DomainError("CONFIG_INVALID", "Server profile requires a PostgreSQL connection URL.");
  }
  if (profile !== "server" && e.AUTOPILOT_DATABASE_URL) {
    throw new DomainError(
      "CONFIG_INVALID",
      "Local and demo profiles use SQLite; remove the database URL.",
    );
  }
  const defaults = [`http://127.0.0.1:${e.AUTOPILOT_PORT}`, "http://127.0.0.1:4318"];
  const allowedOrigins = (e.AUTOPILOT_ALLOWED_ORIGINS?.split(",") ?? defaults).map((s) => s.trim());
  for (const origin of allowedOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new DomainError("CONFIG_INVALID", "Invalid allowed origin.");
    }
    if (url.origin !== origin || (profile === "server" && url.protocol !== "https:")) {
      throw new DomainError(
        "CONFIG_INVALID",
        "Allowed origins must be exact origins; server requires HTTPS.",
      );
    }
  }
  if (profile === "server" && !e.AUTOPILOT_ALLOWED_ORIGINS) {
    throw new DomainError("CONFIG_INVALID", "Server requires explicit allowed origins.");
  }
  return {
    profile,
    dataDir,
    host: e.AUTOPILOT_HOST,
    port: e.AUTOPILOT_PORT,
    ownerId: profile === "demo" ? "synthetic-owner" : e.AUTOPILOT_OWNER_ID,
    ownerToken: e.AUTOPILOT_OWNER_TOKEN,
    databaseUrl: e.AUTOPILOT_DATABASE_URL,
    allowedOrigins,
    externalSubmissionEnabled: false,
  };
}
