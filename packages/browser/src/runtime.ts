import { type Browser, type BrowserContext, chromium, type Page } from "playwright";

export interface OwnedBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  readonly blockedCommitCount: number;
  close(): Promise<void>;
}

async function launchOwnedBrowser(
  origin: string,
  allowMockCommit: boolean,
  visible = false,
): Promise<OwnedBrowser> {
  const allowed = new URL(origin);
  if (allowed.protocol !== "http:" || allowed.hostname !== "127.0.0.1")
    throw new Error("Dry-run browser requires a loopback mock ATS origin.");
  const browser = await chromium.launch({ headless: !visible });
  try {
    let blockedCommitCount = 0;
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(15000);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const destination = new URL(request.url());
      if (
        destination.origin !== allowed.origin ||
        (!allowMockCommit && destination.pathname === "/applications" && request.method() !== "GET")
      ) {
        if (destination.pathname === "/applications") blockedCommitCount++;
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const page = await context.newPage();
    return {
      browser,
      context,
      page,
      get blockedCommitCount() {
        return blockedCommitCount;
      },
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export function launchDryRunBrowser(origin: string, visible = false): Promise<OwnedBrowser> {
  return launchOwnedBrowser(origin, false, visible);
}

export function launchMockCommitBrowser(origin: string): Promise<OwnedBrowser> {
  return launchOwnedBrowser(origin, true);
}
