import { testMobileOrigin, testOrigin } from "../helpers/browser-endpoints.js";

/**
 * A browser test that quietly runs against a private profile would read and
 * write the owner's real candidate database. This refuses to start unless the
 * server answering on the test port is a synthetic demo instance.
 */
export default async function globalSetup() {
  for (const origin of [testOrigin, testMobileOrigin]) await verifyDemo(origin);
}

async function verifyDemo(origin: string) {
  let profile: string | undefined;
  try {
    const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(10000) });
    if (response.ok) profile = ((await response.json()) as { profile?: string }).profile;
  } catch {
    throw new Error(
      `The Playwright web server at ${origin} did not become ready. Install Chromium and choose unused test ports.`,
    );
  }
  if (profile !== "demo") {
    throw new Error(
      `Refusing to run browser tests: the server on ${origin} reports profile "${profile ?? "unknown"}", not "demo". ` +
        "Choose unused test ports. " +
        "Browser tests must never touch a private profile.",
    );
  }
}
