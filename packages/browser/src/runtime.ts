import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { classifyHandoffRequest, type HandoffPolicy } from "./handoff-policy.js";

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
      if (destination.origin !== allowed.origin) return route.abort("blockedbyclient");
      if (
        !allowMockCommit &&
        destination.pathname === "/applications" &&
        request.method() !== "GET"
      ) {
        blockedCommitCount++;
        return route.fulfill({
          status: 409,
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><title>Final action blocked</title><p>Dry-run final action blocked.</p>",
        });
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

/**
 * The visible handoff browser. Unlike the dry-run browser it is not restricted to
 * loopback, because its whole purpose is to show a real portal page. The
 * restriction it does carry is the prepared-URL policy: the target origin is
 * pinned, a cross-origin write is refused, a cross-origin top-level navigation is
 * refused, and the declared final-action paths can never be written.
 */
export function launchHandoffBrowser(policy: HandoffPolicy, visible = true): Promise<OwnedBrowser> {
  return launchPolicyBrowser(policy, visible, {
    acceptDownloads: false,
    serviceWorkers: "block",
    permissions: [],
  });
}

async function launchPolicyBrowser(
  policy: HandoffPolicy,
  visible: boolean,
  contextOptions: Parameters<Browser["newContext"]>[0],
): Promise<OwnedBrowser> {
  const browser = await chromium.launch({ headless: !visible });
  try {
    let blockedCommitCount = 0;
    const context = await browser.newContext({
      ...contextOptions,
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(15000);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const verdict = classifyHandoffRequest(policy, {
        url: request.url(),
        method: () => request.method(),
        resourceType: () => request.resourceType(),
        isMainFrame: () => request.frame() === context.pages()[0]?.mainFrame(),
      });
      if (verdict === "block_final_action") {
        blockedCommitCount++;
        return route.fulfill({
          status: 409,
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><title>Final action blocked</title><p>The final application action is blocked during a challenge handoff.</p>",
        });
      }
      if (verdict === "block_offsite") return route.abort("blockedbyclient");
      // The challenged portal URL identifies the vacancy and the candidate to any
      // third party that read a Referer header, so it is stripped on the way out.
      const headers = { ...request.headers() };
      delete headers.referer;
      return route.continue({ headers });
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
