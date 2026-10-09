import { isIP } from "node:net";
import { DomainError } from "../../contracts/src/index.js";

/**
 * A handoff lets the owner interact with one page on one portal. It must never be
 * able to become a general browsing session, and it must never be able to
 * perform the final application action on the owner's behalf.
 *
 * The security property that makes this safe is that the only URL the broker may
 * open is the exact URL an already-verified preparation inspected and
 * fingerprinted. That URL is in a database row written by an adapter that
 * enforces its own exact-origin policy, and the handoff repository re-verifies
 * the adapter identity and target fingerprint before the broker is called. An
 * allowlist of employer hosts would be a second, weaker source of truth.
 */
export interface HandoffCapability {
  readonly adapterId: string;
  /**
   * `prepared-url` reopens the inspected URL itself. `fixture-server` rebuilds an
   * owned loopback fixture and navigates to the recorded path, which is what the
   * mock ATS needs because its preparation server is already closed.
   */
  readonly navigation: "prepared-url" | "fixture-server";
  /** Selector identifying the outstanding challenge control. */
  readonly challengeSelector: string;
  /** Paths whose non-GET request is the final application action. */
  readonly finalActionPaths: readonly string[];
  readonly challengeWritePaths?: readonly string[];
  readonly completionSelector?: string;
  /** Reviewed employer authentication cookies only, never challenge tokens. */
  readonly sessionCookieNames?: readonly string[];
}

const MOCK_CHALLENGE: HandoffCapability = {
  adapterId: "mock-ats",
  navigation: "fixture-server",
  challengeSelector: "[data-challenge]:not([hidden])",
  finalActionPaths: ["/applications"],
  challengeWritePaths: ["/challenge/verify"],
  completionSelector: "form#application",
  sessionCookieNames: ["mock_owner_session"],
};

const HOSTED_CHALLENGE: HandoffCapability = {
  adapterId: "greenhouse",
  navigation: "prepared-url",
  challengeSelector:
    "[data-challenge]:not([hidden]), .g-recaptcha:not([hidden]), iframe[src*='recaptcha']",
  finalActionPaths: ["/jobs/submit", "/forms/submit", "/submit"],
  challengeWritePaths: ["/challenge/verify"],
  completionSelector: "form:has(button[type='submit'])",
};

const API_CHALLENGE: HandoffCapability = {
  adapterId: "recruitee",
  navigation: "prepared-url",
  challengeSelector:
    "[data-challenge]:not([hidden]), .g-recaptcha:not([hidden]), iframe[src*='recaptcha']",
  finalActionPaths: ["/candidates", "/api/candidates"],
  challengeWritePaths: ["/challenge/verify"],
  completionSelector: "form:has(button[type='submit'])",
};

const CAPABILITIES = new Map<string, HandoffCapability>(
  [MOCK_CHALLENGE, HOSTED_CHALLENGE, API_CHALLENGE].map((item) => [item.adapterId, item]),
);

export function handoffCapability(adapterId: string): HandoffCapability | null {
  return CAPABILITIES.get(adapterId) ?? null;
}

export function allowedHandoffCookie(capability: HandoffCapability, name: string): boolean {
  return (
    (capability.sessionCookieNames?.includes(name) ?? false) &&
    !/captcha|challenge|turnstile|cf_clearance|^_?abck$|^bm_/i.test(name)
  );
}

export function registerHandoffCapability(capability: HandoffCapability): void {
  CAPABILITIES.set(capability.adapterId, capability);
}

/**
 * The prepared URL must be a real portal page: HTTPS for anything remote, and
 * plain HTTP only on loopback, which is exclusively the owned test fixture.
 */
export function assertHandoffUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError("FORM_CHANGED", "The prepared handoff URL is not a valid URL.");
  }
  const loopback = url.hostname === "127.0.0.1";
  if (
    url.protocol === "https:" &&
    !isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
    !/(^|\.)(localhost|local|internal)$/.test(url.hostname)
  ) {
    // Any real portal page, resolved to exactly the URL that was inspected.
  } else if (url.protocol === "http:" && loopback) {
    // Plain HTTP is accepted only for the owned loopback test fixture.
  } else {
    throw new DomainError("ORIGIN_DENIED", "A handoff may only open an approved portal origin.");
  }
  if (url.username || url.password)
    throw new DomainError("ORIGIN_DENIED", "A handoff URL may not carry credentials.");
  return url;
}

export type HandoffVerdict = "allow" | "block_final_action" | "block_offsite";

export interface HandoffRequest {
  readonly url: string;
  method(): string;
  resourceType(): string;
  isMainFrame(): boolean;
}

export interface HandoffPolicy {
  readonly origin: string;
  readonly finalActionPaths: readonly string[];
  readonly challengeWritePaths?: readonly string[];
  readonly pageUrl?: string;
}

const challengeResourceOrigins = new Set([
  "https://www.google.com",
  "https://www.gstatic.com",
  "https://www.recaptcha.net",
]);

/**
 * A challenge widget legitimately loads scripts, images and iframes from its
 * vendor, so reviewed HTTPS widget origins may serve subresources. Unknown
 * writes are blocked even on the prepared origin; an endpoint blacklist cannot
 * reliably identify every possible final action.
 */
export function classifyHandoffRequest(
  policy: HandoffPolicy,
  request: HandoffRequest,
): HandoffVerdict {
  let destination: URL;
  try {
    destination = new URL(request.url);
  } catch {
    return "block_offsite";
  }
  if (
    destination.username ||
    destination.password ||
    !["https:", "http:"].includes(destination.protocol)
  )
    return "block_offsite";
  const write = !["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase());
  if (destination.origin !== policy.origin) {
    if (write) return "block_offsite";
    if (request.isMainFrame() && request.resourceType() === "document") return "block_offsite";
    return challengeResourceOrigins.has(destination.origin) &&
      destination.pathname.startsWith("/recaptcha/")
      ? "allow"
      : "block_offsite";
  }
  if (
    policy.finalActionPaths.some(
      (path) => destination.pathname === path || destination.pathname.startsWith(`${path}/`),
    )
  )
    return "block_final_action";
  if (write && !policy.challengeWritePaths?.includes(destination.pathname))
    return "block_final_action";
  if (
    policy.pageUrl &&
    request.isMainFrame() &&
    request.resourceType() === "document" &&
    destination.pathname !== new URL(policy.pageUrl).pathname
  )
    return "block_offsite";
  return "allow";
}
