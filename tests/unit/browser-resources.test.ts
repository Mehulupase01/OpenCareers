import { EventEmitter } from "node:events";
import type { Browser, BrowserContext } from "playwright";
import { describe, expect, it } from "vitest";
import { BrowserResources, browserProcessEnv } from "../../packages/browser/src/resources.js";

function fakeBrowser() {
  const events = new EventEmitter();
  let connected = true;
  const contexts: EventEmitter[] = [];
  const browser = Object.assign(events, {
    isConnected: () => connected,
    newContext: async () => {
      const context = new EventEmitter();
      contexts.push(context);
      return context as unknown as BrowserContext;
    },
    close: async () => {
      connected = false;
      events.emit("disconnected");
      for (const context of contexts) context.emit("close");
    },
  }) as unknown as Browser;
  return { browser, contexts };
}

describe("browser resource bounds", () => {
  it("keeps only OS essentials out of credential-bearing environment variables", () => {
    expect(
      browserProcessEnv({
        Path: "synthetic-bin",
        HOME: "synthetic-home",
        AUTOPILOT_OWNER_TOKEN: "synthetic-secret",
        AUTOPILOT_OPENROUTER_API_KEY: "synthetic-secret",
        AUTOPILOT_VAULT_KEY: "synthetic-secret",
        GOOGLE_CLIENT_SECRET: "synthetic-secret",
      }),
    ).toEqual({ Path: "synthetic-bin", HOME: "synthetic-home" });
  });
  it("reserves launch capacity before awaiting Chromium and releases failed launches", async () => {
    const resources = new BrowserResources(1);
    let reject!: (error: Error) => void;
    const pending = resources.launch(
      {},
      () =>
        new Promise<Browser>((_, fail) => {
          reject = fail;
        }),
    );
    await expect(resources.launch({})).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      retryable: true,
    });
    expect(resources.snapshot().openingBrowsers).toBe(1);
    reject(new Error("Synthetic launch failure"));
    await expect(pending).rejects.toThrow("Synthetic launch failure");
    expect(resources.snapshot()).toMatchObject({ browsers: 0, openingBrowsers: 0, failures: 1 });
    const { browser } = fakeBrowser();
    await resources.launch({}, async () => browser);
    await browser.close();
    expect(resources.snapshot()).toMatchObject({ browsers: 0, launches: 1, peakBrowsers: 1 });
  });

  it("bounds contexts and releases exactly once on close and disconnect", async () => {
    const resources = new BrowserResources(1);
    const { browser, contexts } = fakeBrowser();
    await resources.launch({}, async () => browser);
    await resources.context(browser, {});
    await expect(resources.context(browser, {})).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    contexts[0]?.emit("close");
    await resources.context(browser, {});
    await browser.close();
    expect(resources.snapshot()).toMatchObject({
      contexts: 0,
      browsers: 0,
      openingContexts: 0,
      peakContexts: 1,
    });
  });

  it("clears failed context reservations and rejects invalid resource limits", async () => {
    const resources = new BrowserResources(1);
    const { browser } = fakeBrowser();
    browser.newContext = async () => {
      throw new Error("Synthetic context failure");
    };
    await resources.launch({}, async () => browser);
    await expect(resources.context(browser, {})).rejects.toThrow("Synthetic context failure");
    expect(resources.snapshot()).toMatchObject({ contexts: 0, openingContexts: 0, failures: 1 });
    await browser.close();
    for (const limit of [0, 5, 1.5]) expect(() => new BrowserResources(limit)).toThrow();
  });
});
