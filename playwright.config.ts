import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:4318", trace: "retain-on-failure" },
  webServer: {
    command: "node --import tsx scripts/dev.ts",
    url: "http://127.0.0.1:4318/health/ready",
    // Never reuse a server that is already listening. On a developer machine
    // that listener is usually the owner's own private local instance, and a
    // browser test must never read or write a real candidate database.
    reuseExistingServer: false,
    // The private `.env` is deliberately not loaded, so these values win.
    env: {
      AUTOPILOT_SKIP_ENV_FILE: "1",
      AUTOPILOT_PROFILE: "demo",
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
