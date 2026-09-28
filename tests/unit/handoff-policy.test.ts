import { describe, expect, it } from "vitest";
import {
  assertHandoffUrl,
  classifyHandoffRequest,
  type HandoffPolicy,
  type HandoffRequest,
  handoffCapability,
} from "../../packages/browser/src/handoff-policy.js";

const policy: HandoffPolicy = {
  origin: "https://job-boards.greenhouse.io",
  finalActionPaths: ["/forms/submit"],
};

const request = (
  url: string,
  method = "GET",
  resourceType = "document",
  isMainFrame = true,
): HandoffRequest => ({
  url,
  method: () => method,
  resourceType: () => resourceType,
  isMainFrame: () => isMainFrame,
});

describe("handoff adapter capability", () => {
  it("declares a supported adapter and refuses an unknown one", () => {
    expect(handoffCapability("mock-ats")?.navigation).toBe("fixture-server");
    expect(handoffCapability("greenhouse")?.navigation).toBe("prepared-url");
    expect(handoffCapability("recruitee")?.navigation).toBe("prepared-url");
    expect(handoffCapability("workday")).toBeNull();
  });

  it("always names at least one final action path for an external adapter", () => {
    for (const id of ["mock-ats", "greenhouse", "recruitee"]) {
      expect(handoffCapability(id)?.finalActionPaths.length).toBeGreaterThan(0);
    }
  });
});

describe("handoff URL policy", () => {
  it("accepts a real portal page and the owned loopback fixture", () => {
    expect(assertHandoffUrl("https://job-boards.greenhouse.io/adyen/jobs/7342890").origin).toBe(
      "https://job-boards.greenhouse.io",
    );
    expect(assertHandoffUrl("http://127.0.0.1:5321/jobs/hosted").hostname).toBe("127.0.0.1");
  });

  it("refuses a non-portal scheme, a remote plain-HTTP host and embedded credentials", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://boards.greenhouse.io/jobs/1",
      "javascript:alert(1)",
      "http://careers.evil.example/jobs/1",
      "https://user:pass@job-boards.greenhouse.io/jobs/1",
      "not a url",
    ]) {
      expect(() => assertHandoffUrl(url)).toThrow();
    }
  });
});

describe("handoff request classification", () => {
  it("allows reading the prepared page and its own subresources", () => {
    expect(classifyHandoffRequest(policy, request(`${policy.origin}/jobs/1`))).toBe("allow");
    expect(
      classifyHandoffRequest(policy, request(`${policy.origin}/assets/app.js`, "GET", "script")),
    ).toBe("allow");
  });

  it("blocks the final application action and nothing else that writes", () => {
    expect(
      classifyHandoffRequest(policy, request(`${policy.origin}/forms/submit`, "POST", "document")),
    ).toBe("block_final_action");
    // A challenge widget legitimately posts its own token to the same origin.
    expect(
      classifyHandoffRequest(policy, request(`${policy.origin}/challenge/verify`, "POST")),
    ).toBe("allow");
    // A path that merely starts with the final action path is not that action.
    expect(
      classifyHandoffRequest(policy, request(`${policy.origin}/forms/submit/extra`, "POST")),
    ).toBe("allow");
  });

  it("allows a challenge vendor's cross-origin subresources but never its writes", () => {
    expect(
      classifyHandoffRequest(
        policy,
        request("https://www.recaptcha.net/recaptcha/api2/anchor", "GET", "script", false),
      ),
    ).toBe("allow");
    expect(
      classifyHandoffRequest(
        policy,
        request("https://www.recaptcha.net/recaptcha/api2/anchor", "GET", "document", false),
      ),
    ).toBe("allow");
    expect(
      classifyHandoffRequest(
        policy,
        request("https://collector.evil.example/collect", "POST", "xhr", false),
      ),
    ).toBe("block_offsite");
  });

  it("refuses a cross-origin top-level navigation so the session cannot drift", () => {
    expect(
      classifyHandoffRequest(
        policy,
        request("https://phish.example/login", "GET", "document", true),
      ),
    ).toBe("block_offsite");
  });

  it("refuses to classify an unparseable request as anything but offsite", () => {
    expect(classifyHandoffRequest(policy, request("::::"))).toBe("block_offsite");
  });

  it("pins the loopback fixture with the same rules as a remote portal", () => {
    const loopback: HandoffPolicy = {
      origin: "http://127.0.0.1:5321",
      finalActionPaths: ["/forms/submit"],
    };
    expect(
      classifyHandoffRequest(loopback, request(`${loopback.origin}/forms/submit`, "POST")),
    ).toBe("block_final_action");
    expect(
      classifyHandoffRequest(loopback, request("http://127.0.0.1:9999/forms/submit", "POST")),
    ).toBe("block_offsite");
  });
});
