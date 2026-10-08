import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { DomainError } from "../../contracts/src/index.js";

const envSchema = z.object({
  AUTOPILOT_PROFILE: z.enum(["demo", "local", "server"]).default("demo"),
  AUTOPILOT_HOST: z.string().default("127.0.0.1"),
  AUTOPILOT_PORT: z.coerce.number().int().min(1024).max(65535).default(4317),
  AUTOPILOT_DATA_DIR: z.string().optional(),
  AUTOPILOT_E2E_RUN_ID: z.uuid().optional(),
  AUTOPILOT_OWNER_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_.:-]+$/)
    .default("local-owner"),
  AUTOPILOT_OWNER_TOKEN: z.string().min(32).optional(),
  AUTOPILOT_VAULT_KEY: z.string().optional(),
  AUTOPILOT_RESTORE_SNAPSHOT_SHA256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  AUTOPILOT_DATABASE_URL: z.string().optional(),
  AUTOPILOT_ALLOWED_ORIGINS: z.string().optional(),
  AUTOPILOT_OPENROUTER_API_KEY: z.string().min(20).max(512).optional(),
  AUTOPILOT_OPENROUTER_MODEL_ALLOWLIST: z.string().optional(),
  AUTOPILOT_OPENROUTER_PROVIDER_ALLOWLIST: z.string().optional(),
  AUTOPILOT_INFERENCE_DAILY_LIMIT: z.coerce.number().int().min(1).max(50).default(40),
  AUTOPILOT_EXTERNAL_SUBMISSION: z.enum(["true", "false"]).default("false"),
});

export interface Config {
  profile: "demo" | "local" | "server";
  host: string;
  port: number;
  dataDir: string;
  ownerId: string;
  ownerToken: string | undefined;
  vaultKey: string | undefined;
  restoreSnapshotSha256?: string | undefined;
  databaseUrl: string | undefined;
  allowedOrigins: string[];
  inference: {
    enabled: boolean;
    apiKey: string | undefined;
    dailyLimit: number;
    modelAllowlist: string[];
    providerAllowlist: string[];
  };
  externalSubmissionEnabled: boolean;
}

function list(value: string | undefined, pattern: RegExp, label: string): string[] {
  const values = [...new Set((value?.split(",") ?? []).map((item) => item.trim()).filter(Boolean))];
  if (values.some((item) => !pattern.test(item)))
    throw new DomainError("CONFIG_INVALID", `Invalid ${label} allowlist.`);
  return values;
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
  if (profile === "demo" && e.AUTOPILOT_RESTORE_SNAPSHOT_SHA256)
    throw new DomainError(
      "CONFIG_INVALID",
      "Restore activation is only supported for private profiles.",
    );
  if (e.AUTOPILOT_E2E_RUN_ID && profile !== "demo")
    throw new DomainError(
      "CONFIG_INVALID",
      "Browser-test run IDs are only supported in demo mode.",
    );
  const demoDir = e.AUTOPILOT_E2E_RUN_ID
    ? resolve(cwd, ".data/e2e", e.AUTOPILOT_E2E_RUN_ID)
    : resolve(cwd, ".data/demo");
  const dataDir = resolve(e.AUTOPILOT_DATA_DIR ?? demoDir);
  if (profile !== "server" && !["127.0.0.1", "::1"].includes(e.AUTOPILOT_HOST)) {
    throw new DomainError("CONFIG_INVALID", "Demo and local profiles must bind to loopback.");
  }
  if (profile === "demo" && dataDir !== demoDir) {
    throw new DomainError(
      "CONFIG_INVALID",
      "Demo data must use its guarded repository demo directory.",
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
  const modelAllowlist = list(
    e.AUTOPILOT_OPENROUTER_MODEL_ALLOWLIST,
    /^[a-zA-Z0-9_./~:-]+$/,
    "model",
  );
  const providerAllowlist = list(
    e.AUTOPILOT_OPENROUTER_PROVIDER_ALLOWLIST,
    /^[a-zA-Z0-9_-]+$/,
    "provider",
  );
  if (modelAllowlist.some((model) => !model.endsWith(":free")))
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Only explicitly free model variants are allowed.",
    );
  if (profile === "demo" && e.AUTOPILOT_OPENROUTER_API_KEY)
    throw new DomainError("CONFIG_INVALID", "Demo cannot use an external inference key.");
  const externalSubmissionEnabled = e.AUTOPILOT_EXTERNAL_SUBMISSION === "true";
  if (profile === "demo" && externalSubmissionEnabled)
    throw new DomainError("CONFIG_INVALID", "Demo cannot enable external submissions.");
  if (e.AUTOPILOT_OPENROUTER_API_KEY && (!modelAllowlist.length || !providerAllowlist.length))
    throw new DomainError(
      "MODEL_ROUTE_INELIGIBLE",
      "Inference keys require explicit free-model and provider allowlists.",
    );
  if (!e.AUTOPILOT_OPENROUTER_API_KEY && (modelAllowlist.length || providerAllowlist.length))
    throw new DomainError("CONFIG_INVALID", "Inference allowlists require an OpenRouter API key.");
  if (e.AUTOPILOT_VAULT_KEY) {
    const decoded = Buffer.from(e.AUTOPILOT_VAULT_KEY, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== e.AUTOPILOT_VAULT_KEY)
      throw new DomainError(
        "CONFIG_INVALID",
        "AUTOPILOT_VAULT_KEY must be canonical base64 for exactly 32 random bytes.",
      );
  }
  // A private profile without a vault key cannot run account workflows, but it
  // must still boot so the owner can be told what is missing. A demo profile is
  // synthetic by construction and gets a published constant key so the account
  // surfaces are demonstrable; it can only ever reach the bundled mock ATS.
  const vaultKey =
    e.AUTOPILOT_VAULT_KEY ??
    (profile === "demo" ? Buffer.alloc(32, 0x64).toString("base64") : undefined);
  return {
    profile,
    dataDir,
    host: e.AUTOPILOT_HOST,
    port: e.AUTOPILOT_PORT,
    ownerId: profile === "demo" ? "synthetic-owner" : e.AUTOPILOT_OWNER_ID,
    ownerToken: e.AUTOPILOT_OWNER_TOKEN,
    vaultKey,
    restoreSnapshotSha256: e.AUTOPILOT_RESTORE_SNAPSHOT_SHA256,
    databaseUrl: e.AUTOPILOT_DATABASE_URL,
    allowedOrigins,
    inference: {
      enabled: Boolean(e.AUTOPILOT_OPENROUTER_API_KEY),
      apiKey: e.AUTOPILOT_OPENROUTER_API_KEY,
      dailyLimit: e.AUTOPILOT_INFERENCE_DAILY_LIMIT,
      modelAllowlist,
      providerAllowlist,
    },
    externalSubmissionEnabled,
  };
}
