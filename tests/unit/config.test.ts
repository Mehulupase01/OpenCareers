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
  it("rejects paid, ambiguous and demo inference configuration", () => {
    const privateEnv = {
      AUTOPILOT_PROFILE: "local",
      AUTOPILOT_DATA_DIR: "D:/private-opencareers-test",
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
