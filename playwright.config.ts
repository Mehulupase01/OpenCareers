import { defineConfig, devices } from "@playwright/test";
import { testApiPort, testOrigin, testWebPort } from "./tests/helpers/browser-endpoints.js";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: testOrigin, trace: "retain-on-failure" },
  webServer: {
    command: "node --import tsx scripts/dev.ts",
    url: `${testOrigin}/health/ready`,
    // Never reuse a server that is already listening. On a developer machine
    // that listener is usually the owner's own private local instance, and a
    // browser test must never read or write a real candidate database.
    reuseExistingServer: false,
    // The private `.env` is deliberately not loaded, so these values win.
    env: {
      AUTOPILOT_SKIP_ENV_FILE: "1",
      AUTOPILOT_PROFILE: "demo",
      AUTOPILOT_PORT: String(testApiPort),
      AUTOPILOT_WEB_PORT: String(testWebPort),
      AUTOPILOT_ALLOWED_ORIGINS: `${testOrigin},http://127.0.0.1:${testApiPort}`,
    },
    timeout: 60000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
