import { type Browser, chromium } from "playwright";
import { DomainError } from "../../contracts/src/index.js";

export function browserProcessEnv(env: NodeJS.ProcessEnv = process.env) {
  const allowed = new Set([
    "path",
    "systemroot",
    "windir",
    "temp",
    "tmp",
    "userprofile",
    "appdata",
    "localappdata",
    "comspec",
    "pathext",
    "home",
    "display",
    "wayland_display",
    "xdg_runtime_dir",
    "xauthority",
    "lang",
    "lc_all",
    "tz",
  ]);
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => allowed.has(key.toLowerCase()) && value !== undefined,
    ),
  ) as Record<string, string>;
}

export class BrowserResources {
  private browsers = 0;
  private contexts = 0;
  private openingBrowsers = 0;
  private openingContexts = 0;
  private peakBrowsers = 0;
  private peakContexts = 0;
  private launches = 0;
  private failures = 0;

  constructor(private readonly limit = 4) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 4)
      throw new Error("Browser resource limit must be between 1 and 4.");
  }

  snapshot() {
    return {
      scope: "current_process" as const,
      limit: this.limit,
      browsers: this.browsers,
      contexts: this.contexts,
      openingBrowsers: this.openingBrowsers,
      openingContexts: this.openingContexts,
      peakBrowsers: this.peakBrowsers,
      peakContexts: this.peakContexts,
      launches: this.launches,
      failures: this.failures,
    };
  }

  async launch(
    options: Parameters<typeof chromium.launch>[0],
    launcher = chromium.launch.bind(chromium),
  ): Promise<Browser> {
    if (this.browsers + this.openingBrowsers >= this.limit)
      throw new DomainError("STORAGE_UNAVAILABLE", "Browser process capacity is occupied.", true);
    this.openingBrowsers++;
    try {
      const browser = await launcher({ ...options, env: browserProcessEnv() });
      this.browsers++;
      this.launches++;
      this.peakBrowsers = Math.max(this.peakBrowsers, this.browsers);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.browsers--;
      };
      browser.once("disconnected", release);
      if (!browser.isConnected()) release();
      return browser;
    } catch (error) {
      this.failures++;
      throw error;
    } finally {
      this.openingBrowsers--;
    }
  }

  async context(browser: Browser, options: Parameters<Browser["newContext"]>[0]) {
    if (this.contexts + this.openingContexts >= this.limit)
      throw new DomainError("STORAGE_UNAVAILABLE", "Browser context capacity is occupied.", true);
    this.openingContexts++;
    try {
      const context = await browser.newContext(options);
      this.contexts++;
      this.peakContexts = Math.max(this.peakContexts, this.contexts);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.contexts--;
        browser.off("disconnected", release);
      };
      context.once("close", release);
      browser.once("disconnected", release);
      if (!browser.isConnected()) release();
      return context;
    } catch (error) {
      this.failures++;
      throw error;
    } finally {
      this.openingContexts--;
    }
  }
}

export const browserResources = new BrowserResources();
