import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  authorizationStatus,
  chronology,
  conflictingFacts,
  factStatus,
  usableFact,
} from "../../packages/candidate/src/domain.js";
import {
  type Authorization,
  type CandidateFact,
  factSchema,
  policyInputSchema,
} from "../../packages/contracts/src/candidate.js";
import { identity, policy } from "../helpers/candidate-fixtures.js";

function employment(
  start: string,
  end: string,
  workload: "full_time" | "part_time" = "full_time",
): CandidateFact {
  const { expectedRevision: _, ...base } = identity;
  return factSchema.parse({
    ...base,
    id: `employment-${start}-${end}-${workload}`,
    key: `${start}-${end}-${workload}`,
    value: {
      kind: "employment",
      employer: "Synthetic",
      title: "Engineer",
      start,
      end,
      workload,
      description: "",
    },
    revision: 1,
    status: "owner_asserted",
    recordedAt: "2026-09-16T00:00:00Z",
    reviewedAt: "2026-09-16T00:00:00Z",
  });
}
describe("candidate truth and chronology", () => {
  it("labels time-expired facts and policy states without granting authority", () => {
    const now = new Date("2026-09-16T10:00:00Z");
    const grant: Authorization = {
      ...policy("profile"),
      id: "policy",
      candidateId: "candidate",
      revision: 1,
      revokedAt: null,
    };
    expect(authorizationStatus(null, now)).toBe("Not configured");
    expect(authorizationStatus(grant, now)).toBe("auto submit");
    expect(authorizationStatus({ ...grant, effectiveAt: "2026-09-17T00:00:00Z" }, now)).toBe(
      "Scheduled",
    );
    expect(authorizationStatus({ ...grant, expiresAt: now.toISOString() }, now)).toBe("Expired");
    expect(authorizationStatus({ ...grant, revokedAt: now.toISOString() }, now)).toBe("Revoked");
    expect(
      factStatus({ ...employment("2020-01", "2020-12"), expiresOn: "2026-09-15" }, "2026-09-16"),
    ).toBe("expired");
  });
  it("unions employment months while keeping workload totals separate", () => {
    expect(
      chronology(
        [employment("2019-01", "2019-12"), employment("2019-06", "2020-05", "part_time")],
        "2026-09-16",
      ),
    ).toMatchObject({ totalMonths: 17, fullTimeMonths: 12, partTimeMonths: 12, issues: [] });
  });
  it("matches a set-based reference for arbitrary overlapping intervals", () => {
    const month = (n: number) =>
      `${2000 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 240 }), fc.integer({ min: 0, max: 240 })), {
          maxLength: 40,
        }),
        (pairs) => {
          const months = new Set<number>();
          const facts = pairs.map(([a, b]) => {
            const from = Math.min(a, b);
            const to = Math.max(a, b);
            for (let i = from; i <= to; i++) months.add(i);
            return employment(month(from), month(to));
          });
          expect(chronology(facts, "2026-09-16").totalMonths).toBe(months.size);
        },
      ),
    );
  });
  it("withholds expired, conflicting and extracted facts and detects implausible dates", () => {
    const fact = employment("2020-01", "2019-01");
    expect(chronology([fact], "2026-09-16").issues[0]?.code).toBe("CHRONOLOGY_INVALID");
    expect(usableFact({ ...fact, status: "extracted" }, "2026-09-16")).toBe(false);
    expect(usableFact({ ...fact, expiresOn: "2026-09-15" }, "2026-09-16")).toBe(false);
    expect(
      conflictingFacts([
        fact,
        {
          ...fact,
          id: "conflict",
          value: { ...fact.value, kind: "skill", name: "React", firstUsed: "2010-01" },
        },
      ]),
    ).toHaveLength(2);
    expect(
      chronology(
        [{ ...fact, value: { kind: "skill", name: "React", firstUsed: "2010-01" } }],
        "2026-09-16",
      ).issues[0]?.code,
    ).toBe("TECHNOLOGY_DATE_REQUIRES_REVIEW");
  });
  it("requires explicit auto-submit authorization and valid numeric salary ranges", () => {
    expect(
      policyInputSchema.safeParse({ ...policy("profile"), autoSubmitAcknowledged: false }).success,
    ).toBe(false);
    expect(
      policyInputSchema.safeParse({
        ...policy("profile"),
        salary: { minimum: 80000, maximum: 50000, currency: "EUR", period: "year" },
      }).success,
    ).toBe(false);
  });
});
