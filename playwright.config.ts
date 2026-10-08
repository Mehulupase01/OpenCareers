import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import {
  testApiPort,
  testMobileApiPort,
  testMobileOrigin,
  testMobileWebPort,
  testOrigin,
  testWebPort,
} from "./tests/helpers/browser-endpoints.js";

const testServer = (apiPort: number, webPort: number, origin: string) => ({
  command: "node --import tsx scripts/dev.ts",
  url: `${origin}/health/ready`,
  reuseExistingServer: false,
  env: {
    AUTOPILOT_SKIP_ENV_FILE: "1",
    AUTOPILOT_PROFILE: "demo",
    AUTOPILOT_E2E_RUN_ID: randomUUID(),
    AUTOPILOT_PORT: String(apiPort),
    AUTOPILOT_WEB_PORT: String(webPort),
    AUTOPILOT_ALLOWED_ORIGINS: `${origin},http://127.0.0.1:${apiPort}`,
  },
  timeout: 60000,
});

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: testOrigin, trace: "retain-on-failure" },
  // Independent synthetic state prevents one viewport's submissions affecting another.
  webServer: [
    testServer(testApiPort, testWebPort, testOrigin),
    testServer(testMobileApiPort, testMobileWebPort, testMobileOrigin),
  ],
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", baseURL: testMobileOrigin },
    },
  ],
});
