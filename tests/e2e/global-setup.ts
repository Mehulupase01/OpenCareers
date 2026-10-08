import { testApiPort, testOrigin, testWebPort } from "../helpers/browser-endpoints.js";

const READY_URL = `${testOrigin}/health/ready`;

/**
 * A browser test that quietly runs against a private profile would read and
 * write the owner's real candidate database. This refuses to start unless the
 * server answering on the test port is a synthetic demo instance.
 */
export default async function globalSetup() {
  let profile: string | undefined;
  try {
    const response = await fetch(READY_URL, { signal: AbortSignal.timeout(10000) });
    if (response.ok) profile = ((await response.json()) as { profile?: string }).profile;
  } catch {
    throw new Error(
      `The Playwright web server did not become ready. Install Chromium and free test ports ${testApiPort} and ${testWebPort}.`,
    );
  }
  if (profile !== "demo") {
    throw new Error(
      `Refusing to run browser tests: the server on ${testOrigin} reports profile "${profile ?? "unknown"}", not "demo". ` +
        "Choose unused test ports and run `pnpm demo:reset` first. " +
        "Browser tests must never touch a private profile.",
    );
  }
}
