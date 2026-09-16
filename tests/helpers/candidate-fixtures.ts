import type { FactInput, PolicyInput } from "../../packages/contracts/src/candidate.js";

export const identity: FactInput = {
  expectedRevision: 0,
  key: "identity",
  value: {
    kind: "identity",
    fullName: "Alex Example",
    email: "alex@synthetic.example",
    phone: "",
    links: [],
  },
  provenance: { kind: "owner", statement: "Synthetic owner assertion for automated tests." },
  expiresOn: null,
};
export function policy(profileVersionId: string): PolicyInput {
  return {
    expectedRevision: 0,
    mode: "auto_submit",
    profileVersionId,
    roleTerms: ["Engineer"],
    countries: ["NL"],
    blockedEmployerIds: [],
    dailyLimit: 5,
    allowAccountCreation: false,
    allowOptionalDisclosures: false,
    sponsorshipWording: null,
    salary: null,
    salaryNegotiable: null,
    effectiveAt: "2026-09-16T00:00:00.000Z",
    expiresAt: "2026-10-16T00:00:00.000Z",
    autoSubmitAcknowledged: true,
  };
}
