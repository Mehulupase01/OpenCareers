import { describe, expect, it } from "vitest";
import { inspectionTarget } from "../../apps/worker/src/inspection.js";

describe("automatic inspection target resolution", () => {
  it("keeps demo targets on the owned mock regardless of a fixture's public-shaped URL", () => {
    expect(inspectionTarget("https://synthetic.example/job", "demo")).toEqual({
      adapterId: "mock-ats",
      target: { fixture: "standard" },
    });
  });

  it("resolves only an exact Recruitee tenant and offer path", () => {
    expect(
      inspectionTarget(
        "https://synthetic-employer.recruitee.com/o/platform-engineer?source=test",
        "local",
      ),
    ).toEqual({
      adapterId: "recruitee",
      target: { tenant: "synthetic-employer", offerSlug: "platform-engineer" },
    });
    expect(
      inspectionTarget("https://synthetic.recruitee.com/o/engineer/", "server").adapterId,
    ).toBe("recruitee");
  });

  it("does not turn lookalike, unreviewed or credential-bearing URLs into application targets", () => {
    for (const url of [
      "http://synthetic.recruitee.com/o/engineer",
      "https://synthetic.recruitee.com.evil.example/o/engineer",
      "https://user:pass@synthetic.recruitee.com/o/engineer",
      "https://synthetic.recruitee.com:444/o/engineer",
      "https://synthetic.recruitee.com/api/offers/engineer",
      "https://synthetic.recruitee.com/o/a/b",
      "https://127.0.0.1/o/engineer",
      "https://job-boards.greenhouse.io/synthetic/jobs/123",
    ])
      expect(() => inspectionTarget(url, "local")).toThrow();
  });
});
