import type { Page } from "playwright";
import type { DryRunResult } from "../../contracts/src/browser.js";
import {
  type BrowserSessionState,
  browserSessionSchema,
} from "../../contracts/src/browser-session.js";
import type { HandoffSession } from "../../contracts/src/handoff.js";
import { DomainError } from "../../contracts/src/index.js";
import { startMockAts } from "../../mock-ats/src/server.js";
import { allowedHandoffCookie, assertHandoffUrl, handoffCapability } from "./handoff-policy.js";
import { launchDryRunBrowser, launchHandoffBrowser, type OwnedBrowser } from "./runtime.js";

interface ActiveHandoff {
  browser: OwnedBrowser;
  mock: Awaited<ReturnType<typeof startMockAts>> | null;
  leaseOwner: string;
  generation: number;
  challengeSelector: string;
  completionSelector: string;
  cookieNames: readonly string[];
  pageUrl: string;
  expiryTimer: ReturnType<typeof setTimeout>;
  deadline: number;
}

export interface HandoffBrokerPort {
  open(session: HandoffSession, result: DryRunResult, leaseOwner: string): Promise<void>;
  verify(
    id: string,
    generation: number,
  ): Promise<{ leaseOwner: string; browserSession?: BrowserSessionState }>;
  close(id: string): Promise<void>;
  closeAll(): Promise<void>;
}

export class VisibleHandoffBroker implements HandoffBrokerPort {
  private readonly active = new Map<string, ActiveHandoff>();

  constructor(
    private readonly options: {
      visible?: boolean;
      onOpened?: (page: Page) => Promise<void>;
    } = {},
  ) {}

  async open(session: HandoffSession, result: DryRunResult, leaseOwner: string): Promise<void> {
    if (this.active.has(session.id))
      throw new DomainError("STATE_INVALID", "Handoff browser is already open.");
    const deadline = Math.min(
      Date.parse(session.expiresAt),
      Date.parse(session.leaseUntil ?? session.expiresAt),
    );
    if (!Number.isFinite(deadline) || deadline <= Date.now())
      throw new DomainError("LEASE_STALE", "Handoff browser lease has expired.");
    const capability = handoffCapability(session.adapterId);
    if (
      !capability ||
      result.adapter?.id !== session.adapterId ||
      result.adapter.targetFingerprint !== session.targetFingerprint
    )
      throw new DomainError("STATE_INVALID", "This handoff target is not supported by the broker.");
    const snapshot = result.snapshots.find((item) => item.blocker === "challenge");
    if (!snapshot)
      throw new DomainError("STATE_INVALID", "The preparation has no verification challenge.");

    const visible = this.options.visible ?? true;
    const fixture = capability.navigation === "fixture-server";
    const mock = fixture ? await startMockAts() : null;
    const url = mock
      ? new URL(`/jobs/challenge?jobId=${encodeURIComponent(snapshot.jobId)}`, mock.url)
      : assertHandoffUrl(snapshot.url);
    let browser: OwnedBrowser | undefined;
    try {
      browser = mock
        ? await launchDryRunBrowser(mock.url, visible)
        : await launchHandoffBrowser(
            {
              origin: url.origin,
              pageUrl: url.toString(),
              finalActionPaths: capability.finalActionPaths,
              challengeWritePaths: capability.challengeWritePaths ?? [],
            },
            visible,
          );
      await browser.page.goto(url.toString());
      if ((await browser.page.locator(capability.challengeSelector).count()) !== 1)
        throw new DomainError("FORM_CHANGED", "The verification challenge is no longer present.");
      await this.options.onOpened?.(browser.page);
      if (deadline <= Date.now())
        throw new DomainError("LEASE_STALE", "Handoff lease expired while opening the browser.");
      this.active.set(session.id, {
        browser,
        mock,
        leaseOwner,
        generation: session.generation,
        challengeSelector: capability.challengeSelector,
        completionSelector: capability.completionSelector ?? "form:has(button[type='submit'])",
        cookieNames: (capability.sessionCookieNames ?? []).filter((name) =>
          allowedHandoffCookie(capability, name),
        ),
        pageUrl: url.toString(),
        deadline,
        expiryTimer: setTimeout(
          () => void this.close(session.id),
          Math.max(0, deadline - Date.now()),
        ),
      });
    } catch (error) {
      await browser?.close().catch(() => undefined);
      await mock?.app.close().catch(() => undefined);
      throw error;
    }
  }

  async verify(
    id: string,
    generation: number,
  ): Promise<{ leaseOwner: string; browserSession: BrowserSessionState }> {
    const active = this.active.get(id);
    if (!active || active.generation !== generation)
      throw new DomainError("LEASE_STALE", "Handoff browser generation is stale.");
    if (active.deadline <= Date.now()) {
      await this.close(id);
      throw new DomainError("LEASE_STALE", "Handoff browser lease has expired.");
    }
    if (active.browser.blockedCommitCount > 0)
      throw new DomainError(
        "STATE_INVALID",
        "A final application action was attempted during handoff.",
      );
    if ((await active.browser.page.locator(active.challengeSelector).count()) > 0)
      throw new DomainError("STATE_INVALID", "Complete the verification step before continuing.");
    const actual = new URL(active.browser.page.url());
    const expected = new URL(active.pageUrl);
    if (
      actual.origin !== expected.origin ||
      actual.pathname !== expected.pathname ||
      actual.search !== expected.search ||
      (await active.browser.page.locator(active.completionSelector).count()) !== 1 ||
      !(await active.browser.page.locator(active.completionSelector).isVisible())
    )
      throw new DomainError(
        "FORM_CHANGED",
        "The original application form must remain present after handoff.",
      );
    const cookies = (await active.browser.context.cookies(actual.toString())).filter((cookie) =>
      active.cookieNames.includes(cookie.name),
    );
    const browserSession = browserSessionSchema.parse({
      origin: actual.origin,
      cookies: cookies.map(
        ({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => ({
          name,
          value,
          domain,
          path,
          expires,
          httpOnly,
          secure,
          sameSite,
        }),
      ),
    });
    if (active.deadline <= Date.now() || active.browser.blockedCommitCount > 0)
      throw new DomainError(
        "LEASE_STALE",
        "Handoff changed while its continuation was being verified.",
      );
    return { leaseOwner: active.leaseOwner, browserSession };
  }

  async close(id: string): Promise<void> {
    const active = this.active.get(id);
    if (!active) return;
    this.active.delete(id);
    clearTimeout(active.expiryTimer);
    await active.browser.close().catch(() => undefined);
    await active.mock?.app.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.close(id)));
  }
}
