import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// `loadEnvFile` assigns over the ambient environment, so a process that must not
// inherit the owner's private configuration has to opt out explicitly. The
// Playwright web server sets this so a browser test can never start against a
// private profile or its real database.
if (existsSync(".env") && process.env.AUTOPILOT_SKIP_ENV_FILE !== "1") loadEnvFile(".env");
