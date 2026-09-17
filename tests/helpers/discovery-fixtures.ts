import type { DiscoverySource } from "../../packages/contracts/src/discovery.js";

export const sourceFixture: DiscoverySource = {
  id: "synthetic-source",
  expectedRevision: 1,
  revision: 1,
  connector: "greenhouse",
  board: "synthetic-board",
  region: "global",
  employerId: "synthetic-employer",
  company: "Synthetic Employer",
  intervalSeconds: 300,
  enabled: true,
  mode: "fixture",
  health: "waiting",
  nextPollAt: "2026-09-16T00:00:00Z",
  lastSuccessAt: null,
  lastAttemptAt: null,
  count: 0,
  failures: 0,
  etag: null,
  leaseToken: null,
  leaseUntil: null,
};
export function greenhouseFixture(ids = [1, 2, 3]) {
  return {
    jobs: ids.map((id) => ({
      id,
      internal_job_id: id + 100,
      requisition_id: `REQ-${id}`,
      title: `Software Engineer ${id}`,
      location: { name: "Amsterdam, Netherlands" },
      content: "&lt;p&gt;Build and test reliable synthetic services with Python.&lt;/p&gt;",
      updated_at: "2026-09-16T10:00:00Z",
    })),
    meta: { total: ids.length },
  };
}
export function leverFixture(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${from + index}`,
    text: `Data Engineer ${from + index}`,
    categories: { location: "Amsterdam" },
    country: "NL",
    descriptionPlain: "Build and operate synthetic data services. No real application.",
    lists: [{ text: "Requirements", content: "<ul><li>Python</li></ul>" }],
    workplaceType: "hybrid",
  }));
}
