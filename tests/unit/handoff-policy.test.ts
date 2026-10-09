import { describe, expect, it } from "vitest";
import {
  allowedHandoffCookie,
  assertHandoffUrl,
  classifyHandoffRequest,
  type HandoffPolicy,
  type HandoffRequest,
  handoffCapability,
} from "../../packages/browser/src/handoff-policy.js";

const policy: HandoffPolicy = {
  origin: "https://job-boards.greenhouse.io",
  finalActionPaths: ["/forms/submit"],
  challengeWritePaths: ["/challenge/verify"],
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
  it("never preserves challenge clearance even if a capability mistakenly lists it", () => {
    const capability = handoffCapability("mock-ats");
    if (!capability) throw new Error("Expected synthetic capability.");
    expect(allowedHandoffCookie(capability, "mock_owner_session")).toBe(true);
    expect(allowedHandoffCookie(capability, "unreviewed_session")).toBe(false);
    for (const name of ["cf_clearance", "g-recaptcha-response", "hcaptcha", "_abck", "bm_sz"]) {
      expect(allowedHandoffCookie({ ...capability, sessionCookieNames: [name] }, name)).toBe(false);
    }
  });
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
      "https://127.0.0.1/jobs/1",
      "https://[::1]/jobs/1",
      "https://localhost/jobs/1",
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

  it("blocks final and unknown writes while allowing only reviewed challenge writes", () => {
    expect(
      classifyHandoffRequest(policy, request(`${policy.origin}/forms/submit`, "POST", "document")),
    ).toBe("block_final_action");
    // A challenge widget legitimately posts its own token to the same origin.
    expect(
      classifyHandoffRequest(policy, request(`${policy.origin}/challenge/verify`, "POST")),
    ).toBe("allow");
    // Final-action descendants and newly introduced endpoints fail closed.
    expect(
      classifyHandoffRequest(policy, request(`${policy.origin}/forms/submit/extra`, "POST")),
    ).toBe("block_final_action");
    expect(
      classifyHandoffRequest(policy, request(`${policy.origin}/new-application`, "POST")),
    ).toBe("block_final_action");
    expect(classifyHandoffRequest(policy, request(`${policy.origin}/forms/submit`, "GET"))).toBe(
      "block_final_action",
    );
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

  it("blocks private-network and unreviewed cross-origin resources", () => {
    for (const url of [
      "http://127.0.0.1:4317/v1/candidate",
      "http://169.254.169.254/latest/meta-data",
      "https://collector.evil.example/collect",
      "https://www.recaptcha.net.evil.example/api.js",
      "https://user:pass@www.recaptcha.net/api.js",
      "https://www.google.com/search?q=unreviewed",
    ])
      expect(classifyHandoffRequest(policy, request(url, "GET", "script", false))).toBe(
        "block_offsite",
      );
  });

  it("pins main-frame navigation to the inspected page", () => {
    const pinned = { ...policy, pageUrl: `${policy.origin}/board/jobs/123` };
    expect(classifyHandoffRequest(pinned, request(`${policy.origin}/other-board/jobs/456`))).toBe(
      "block_offsite",
    );
    expect(classifyHandoffRequest(pinned, request(`${pinned.pageUrl}?challenge=solved`))).toBe(
      "allow",
    );
    expect(
      classifyHandoffRequest(pinned, request(`${pinned.pageUrl}?challenge=solved`, "POST")),
    ).toBe("block_final_action");
  });

  it("blocks Recruitee's actual candidate endpoint even without a blacklist entry", () => {
    const recruitee = {
      origin: "https://synthetic.recruitee.com",
      finalActionPaths: ["/candidates"],
    };
    expect(
      classifyHandoffRequest(
        recruitee,
        request(`${recruitee.origin}/api/offers/engineer/candidates`, "POST"),
      ),
    ).toBe("block_final_action");
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
