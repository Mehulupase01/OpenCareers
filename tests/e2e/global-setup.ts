const READY_URL = "http://127.0.0.1:4318/health/ready";

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
      "The Playwright web server did not become ready. Run `pnpm exec playwright install chromium` and free ports 4317 and 4318.",
    );
  }
  if (profile !== "demo") {
    throw new Error(
      `Refusing to run browser tests: the server on 127.0.0.1:4318 reports profile "${profile ?? "unknown"}", not "demo". ` +
        "Stop the process holding ports 4317 and 4318 (for example the private local `pnpm dev` instance) and run `pnpm demo:reset` first. " +
        "Browser tests must never touch a private profile.",
    );
  }
}
