import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../packages/config/src/index.js";
import { sqliteVersionSafe } from "../../packages/persistence/src/database.js";

describe("configuration fails closed", () => {
  it("defaults to synthetic data with external submission disabled", () => {
    expect(loadConfig({})).toMatchObject({
      profile: "demo",
      host: "127.0.0.1",
      externalSubmissionEnabled: false,
      ownerId: "synthetic-owner",
    });
  });
  it("isolates each synthetic browser run without allowing private or arbitrary data overrides", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const config = loadConfig({ AUTOPILOT_E2E_RUN_ID: id });
    expect(config.profile).toBe("demo");
    expect(config.dataDir).toBe(resolve(process.cwd(), ".data/e2e", id));
    expect(config.externalSubmissionEnabled).toBe(false);
    expect(() => loadConfig({ AUTOPILOT_E2E_RUN_ID: "../private" })).toThrow();
    expect(() =>
      loadConfig({ AUTOPILOT_E2E_RUN_ID: id, AUTOPILOT_DATA_DIR: "D:/private" }),
    ).toThrow();
    expect(() => loadConfig({ AUTOPILOT_E2E_RUN_ID: id, AUTOPILOT_PROFILE: "local" })).toThrow(
      /only supported in demo/,
    );
  });
  it("gives a synthetic demo vault key but never a private one", () => {
    const demo = loadConfig({});
    expect(demo.vaultKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(String(demo.vaultKey), "base64")).toHaveLength(32);
    expect(loadConfig({}).vaultKey).toBe(demo.vaultKey);
    expect(
      loadConfig({
        AUTOPILOT_PROFILE: "local",
        AUTOPILOT_DATA_DIR: resolve(process.cwd(), "..", "private-opencareers-submit-test"),
        AUTOPILOT_OWNER_TOKEN: "x".repeat(40),
      }).vaultKey,
    ).toBeUndefined();
  });
  it("rejects a vault key that is not canonical base64 for 32 bytes", () => {
    const base = {
      AUTOPILOT_PROFILE: "local",
      AUTOPILOT_DATA_DIR: resolve(process.cwd(), "..", "private-opencareers-submit-test"),
      AUTOPILOT_OWNER_TOKEN: "x".repeat(40),
    };
    for (const key of [Buffer.alloc(16).toString("base64"), "not base64 at all!!"]) {
      expect(() => loadConfig({ ...base, AUTOPILOT_VAULT_KEY: key })).toThrow(/canonical base64/);
    }
  });
  it("rejects invalid profiles, ports and public local listeners", () => {
    for (const env of [
      { AUTOPILOT_PROFILE: "prod" },
      { AUTOPILOT_PORT: "NaN" },
      { AUTOPILOT_HOST: "0.0.0.0" },
    ])
      expect(() => loadConfig(env)).toThrow();
  });
  it("requires private credentials and rejects demo directory overrides", () => {
    expect(() => loadConfig({ AUTOPILOT_PROFILE: "local" })).toThrow();
    expect(() => loadConfig({ AUTOPILOT_DATA_DIR: "D:/somewhere" })).toThrow();
    expect(() => loadConfig({ AUTOPILOT_EXTERNAL_SUBMISSION: "true" })).toThrow(/Demo/);
    expect(
      loadConfig({
        AUTOPILOT_PROFILE: "local",
        AUTOPILOT_DATA_DIR: resolve(process.cwd(), "..", "private-opencareers-submit-test"),
        AUTOPILOT_OWNER_TOKEN: "x".repeat(40),
        AUTOPILOT_EXTERNAL_SUBMISSION: "true",
      }).externalSubmissionEnabled,
    ).toBe(true);
  });
  it("blocks synced/private-repo data and unconfigured server origins", () => {
    const privateEnv = { AUTOPILOT_PROFILE: "local", AUTOPILOT_OWNER_TOKEN: "x".repeat(40) };
    expect(() =>
      loadConfig({ ...privateEnv, AUTOPILOT_DATA_DIR: "D:/Cloud/OneDrive - Organization/data" }),
    ).toThrow();
    expect(() => loadConfig({ ...privateEnv, AUTOPILOT_DATA_DIR: process.cwd() })).toThrow();
    expect(() =>
      loadConfig({
        ...privateEnv,
        AUTOPILOT_PROFILE: "server",
        AUTOPILOT_DATA_DIR: "D:/private-data",
        AUTOPILOT_DATABASE_URL: "postgresql://localhost/test",
      }),
    ).toThrow();
  });
  it("requires the WAL-reset fix", () => {
    expect(sqliteVersionSafe("3.51.2")).toBe(false);
    for (const v of ["3.51.3", "3.53.0", "3.50.7", "3.44.6"])
      expect(sqliteVersionSafe(v)).toBe(true);
  });
  it("accepts only a canonical 256-bit vault key", () => {
    const privateEnv = {
      AUTOPILOT_PROFILE: "local",
      AUTOPILOT_DATA_DIR: resolve(process.cwd(), "..", "private-opencareers-vault-test"),
      AUTOPILOT_OWNER_TOKEN: "x".repeat(40),
    };
    expect(() => loadConfig({ ...privateEnv, AUTOPILOT_VAULT_KEY: "not-base64" })).toThrow(
      /32 random bytes/,
    );
    expect(() =>
      loadConfig({
        ...privateEnv,
        AUTOPILOT_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).not.toThrow();
  });
  it("rejects paid, ambiguous and demo inference configuration", () => {
    const privateEnv = {
      AUTOPILOT_PROFILE: "local",
      AUTOPILOT_DATA_DIR: resolve(process.cwd(), "..", "private-opencareers-test"),
      AUTOPILOT_OWNER_TOKEN: "x".repeat(40),
      AUTOPILOT_OPENROUTER_API_KEY: "synthetic-key-not-valid-outside-tests",
      AUTOPILOT_OPENROUTER_PROVIDER_ALLOWLIST: "synthetic-provider",
    };
    expect(() =>
      loadConfig({
        ...privateEnv,
        AUTOPILOT_OPENROUTER_MODEL_ALLOWLIST: "vendor/paid-model",
      }),
    ).toThrow(/free model/i);
    expect(() => loadConfig(privateEnv)).toThrow(/allowlist/i);
    expect(() =>
      loadConfig({
        AUTOPILOT_OPENROUTER_API_KEY: "synthetic-key-not-valid-outside-tests",
        AUTOPILOT_OPENROUTER_MODEL_ALLOWLIST: "vendor/model:free",
        AUTOPILOT_OPENROUTER_PROVIDER_ALLOWLIST: "synthetic-provider",
      }),
    ).toThrow(/Demo/);
  });
});
