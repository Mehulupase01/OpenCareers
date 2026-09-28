import type { Page } from "playwright";
import type { DryRunResult } from "../../contracts/src/browser.js";
import type { HandoffSession } from "../../contracts/src/handoff.js";
import { DomainError } from "../../contracts/src/index.js";
import { startMockAts } from "../../mock-ats/src/server.js";
import { launchDryRunBrowser, type OwnedBrowser } from "./runtime.js";

interface ActiveHandoff {
  browser: OwnedBrowser;
  mock: Awaited<ReturnType<typeof startMockAts>>;
  leaseOwner: string;
  generation: number;
  expiryTimer: ReturnType<typeof setTimeout>;
}

export interface HandoffBrokerPort {
  open(session: HandoffSession, result: DryRunResult, leaseOwner: string): Promise<void>;
  verify(id: string, generation: number): Promise<{ leaseOwner: string }>;
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
    if (
      session.adapterId !== "mock-ats" ||
      result.adapter?.id !== session.adapterId ||
      result.adapter.targetFingerprint !== session.targetFingerprint
    )
      throw new DomainError("STATE_INVALID", "This handoff target is not supported by the broker.");
    const snapshot = result.snapshots.find((item) => item.blocker === "challenge");
    if (!snapshot)
      throw new DomainError("STATE_INVALID", "The preparation has no verification challenge.");
    const mock = await startMockAts();
    let browser: OwnedBrowser | undefined;
    try {
      browser = await launchDryRunBrowser(mock.url, this.options.visible ?? true);
      await browser.page.goto(
        `${mock.url}/jobs/challenge?jobId=${encodeURIComponent(snapshot.jobId)}`,
      );
      if ((await browser.page.locator("[data-challenge]:not([hidden])").count()) !== 1)
        throw new DomainError("FORM_CHANGED", "The verification challenge is no longer present.");
      await this.options.onOpened?.(browser.page);
      this.active.set(session.id, {
        browser,
        mock,
        leaseOwner,
        generation: session.generation,
        expiryTimer: setTimeout(
          () => void this.close(session.id),
          Math.max(0, Date.parse(session.expiresAt) - Date.now()),
        ),
      });
    } catch (error) {
      await browser?.close().catch(() => undefined);
      await mock.app.close().catch(() => undefined);
      throw error;
    }
  }

  async verify(id: string, generation: number): Promise<{ leaseOwner: string }> {
    const active = this.active.get(id);
    if (!active || active.generation !== generation)
      throw new DomainError("LEASE_STALE", "Handoff browser generation is stale.");
    if (active.browser.blockedCommitCount > 0)
      throw new DomainError(
        "STATE_INVALID",
        "A final application action was attempted during handoff.",
      );
    if ((await active.browser.page.locator("[data-challenge]:not([hidden])").count()) > 0)
      throw new DomainError("STATE_INVALID", "Complete the verification step before continuing.");
    return { leaseOwner: active.leaseOwner };
  }

  async close(id: string): Promise<void> {
    const active = this.active.get(id);
    if (!active) return;
    this.active.delete(id);
    clearTimeout(active.expiryTimer);
    await active.browser.close().catch(() => undefined);
    await active.mock.app.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.close(id)));
  }
}
