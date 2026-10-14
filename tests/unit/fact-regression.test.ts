import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CandidateFact, FactValue } from "../../packages/contracts/src/candidate.js";
import {
  compileRegressionFixture,
  compileRegressionInput,
  parseRegressionFixture,
  regressionCorrectionSchema,
  regressionFromFactCorrection,
  regressionsFromFactCorrection,
} from "../../packages/security/src/regression-fixture.js";

const employment = {
  kind: "employment",
  employer: "SYNTHETIC-PRIVATE-EMPLOYER",
  title: "SYNTHETIC-PRIVATE-TITLE",
  start: "2013-02",
  end: "2018-11",
  workload: "full_time",
  description: "SYNTHETIC-PRIVATE-DESCRIPTION",
} as const;
const language = {
  kind: "language",
  name: "SYNTHETIC-PRIVATE-LANGUAGE",
  level: "C2",
} as const;
const metric = {
  kind: "metric",
  statement: "SYNTHETIC-PRIVATE-STATEMENT",
  value: 987654321,
  unit: "SYNTHETIC-PRIVATE-UNIT",
  context: "SYNTHETIC-PRIVATE-CONTEXT",
} as const;
const variants = ["employment_period", "language_level", "metric_value"] as const;
const categorical = (variant: (typeof variants)[number]) => ({
  kind: "fact_correction" as const,
  reviewed: true as const,
  variant,
});
const workloadCorrection = {
  kind: "workload_correction",
  reviewed: true,
  before: "full_time",
  after: "part_time",
};

function fact(value: FactValue, revision = 1): CandidateFact {
  return {
    id: "synthetic-private-fact",
    key: "synthetic-private-key",
    revision,
    status: "verified",
    value,
    provenance: { kind: "owner", statement: "SYNTHETIC-PRIVATE-PROVENANCE" },
    expiresOn: "2037-05-17",
    recordedAt: "2026-10-01T02:03:04.000Z",
    reviewedAt: "2026-10-02T03:04:05.000Z",
  };
}

describe("reviewed categorical fact regressions", () => {
  it.each(variants)(
    "compiles only the exact %s category with canonical version-one bytes",
    (variant) => {
      const correction = categorical(variant);
      const expected = { schemaVersion: 1, ...correction };
      const result = compileRegressionFixture(correction);
      const bytes = Buffer.from(`${JSON.stringify(expected, null, 2)}\n`, "utf8");
      expect(result.fixture).toEqual(expected);
      expect(result.bytes).toEqual(bytes);
      expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(parseRegressionFixture(JSON.parse(bytes.toString()))).toEqual(expected);
      expect(compileRegressionInput(correction)).toEqual(result);
      expect(compileRegressionInput(expected)).toEqual(result);
    },
  );

  it.each(variants)("rejects unreviewed, unknown and private fields for %s", (variant) => {
    const correction = categorical(variant);
    for (const invalid of [
      { ...correction, reviewed: false },
      { ...correction, reviewed: undefined },
      { ...correction, variant: "unknown_fact_category" },
      { ...correction, variant: "SYNTHETIC-PRIVATE-TEXT" },
      { ...correction, kind: "unknown_correction" },
      { ...correction, before: "2013-02", after: "2014-03" },
      { ...correction, name: language.name },
      { ...correction, value: metric.value },
      { ...correction, factId: "synthetic-private-fact" },
      { ...correction, key: "synthetic-private-key" },
      { ...correction, text: "SYNTHETIC-PRIVATE-TEXT" },
      { ...correction, url: "https://synthetic-private.example/fact" },
      { ...correction, extra: { facts: [fact(employment)] } },
    ]) {
      expect(regressionCorrectionSchema.safeParse(invalid).success).toBe(false);
      expect(() => compileRegressionFixture(invalid)).toThrow();
      expect(() => parseRegressionFixture({ schemaVersion: 1, ...invalid })).toThrow();
      expect(() => compileRegressionInput({ schemaVersion: 1, ...invalid })).toThrow();
    }
    expect(() => parseRegressionFixture({ schemaVersion: 2, ...correction })).toThrow();
  });

  const changes: { before: FactValue; after: FactValue; variant: (typeof variants)[number] }[] = [
    {
      before: employment,
      after: { ...employment, start: "2014-03" },
      variant: "employment_period",
    },
    { before: employment, after: { ...employment, end: "2019-12" }, variant: "employment_period" },
    { before: employment, after: { ...employment, end: null }, variant: "employment_period" },
    { before: { ...employment, end: null }, after: employment, variant: "employment_period" },
    {
      before: employment,
      after: { ...employment, start: "2014-03", end: "2019-12" },
      variant: "employment_period",
    },
    { before: language, after: { ...language, level: "B1" }, variant: "language_level" },
    {
      before: language,
      after: { ...language, level: "unspecified" },
      variant: "language_level",
    },
    { before: metric, after: { ...metric, value: 123456789 }, variant: "metric_value" },
    { before: metric, after: { ...metric, value: 0 }, variant: "metric_value" },
    { before: metric, after: { ...metric, value: -1.25 }, variant: "metric_value" },
  ];
  it.each(changes)(
    "extracts exactly $variant without any source values",
    ({ before, after, variant }) => {
      const oldFact = fact(before);
      const newFact = fact(after, 3);
      const corrections = regressionsFromFactCorrection(oldFact, newFact);
      expect(corrections).toEqual([categorical(variant)]);
      expect(regressionFromFactCorrection(oldFact, newFact)).toEqual(categorical(variant));
      const published = compileRegressionFixture(corrections[0]);
      const serialized = published.bytes.toString();
      const sentinels = [
        oldFact.id,
        oldFact.key,
        oldFact.recordedAt,
        oldFact.reviewedAt,
        oldFact.expiresOn,
        "SYNTHETIC-PRIVATE-PROVENANCE",
        ...Object.entries(before)
          .filter(([key]) => key !== "kind")
          .map(([, value]) => value),
        ...Object.entries(after)
          .filter(([key]) => key !== "kind")
          .map(([, value]) => value),
      ];
      for (const sentinel of sentinels) {
        if (sentinel !== null) expect(serialized).not.toContain(JSON.stringify(sentinel));
      }
    },
  );

  it("returns workload first and one period correction when workload and both bounds change", () => {
    const before = fact(employment);
    const after = fact({ ...employment, workload: "part_time", start: "2014-03", end: null }, 2);
    expect(regressionsFromFactCorrection(before, after)).toEqual([
      workloadCorrection,
      categorical("employment_period"),
    ]);
    expect(regressionFromFactCorrection(before, after)).toEqual(workloadCorrection);
  });

  it("preserves workload-only corrections in both directions", () => {
    const full = fact(employment);
    const part = fact({ ...employment, workload: "part_time" }, 2);
    expect(regressionsFromFactCorrection(full, part)).toEqual([workloadCorrection]);
    expect(regressionFromFactCorrection(full, part)).toEqual(workloadCorrection);
    expect(regressionsFromFactCorrection(part, { ...full, revision: 3 })).toEqual([
      { ...workloadCorrection, before: "part_time", after: "full_time" },
    ]);
  });

  it.each([employment, language, metric])(
    "ignores a $kind no-op and metadata-only changes",
    (value) => {
      const before = fact(value);
      const after = {
        ...fact(value, 2),
        provenance: { kind: "owner", statement: "Changed provenance" },
      };
      expect(regressionsFromFactCorrection(before, after)).toEqual([]);
      expect(regressionFromFactCorrection(before, after)).toBeNull();
    },
  );

  const unsupported: [FactValue, FactValue][] = [
    [
      employment,
      {
        ...employment,
        employer: "Other synthetic employer",
        title: "Other title",
        description: "Other description",
      },
    ],
    [language, { ...language, name: "Other synthetic language" }],
    [
      metric,
      { ...metric, unit: "Other unit", statement: "Other statement", context: "Other context" },
    ],
    [
      {
        kind: "education",
        institution: "Synthetic school",
        qualification: "Synthetic degree",
        start: "2013-02",
        end: null,
      },
      {
        kind: "education",
        institution: "Synthetic school",
        qualification: "Synthetic degree",
        start: "2014-03",
        end: "2018-11",
      },
    ],
    [
      {
        kind: "project",
        name: "Synthetic project",
        description: "Synthetic description",
        start: "2013-02",
        end: null,
      },
      {
        kind: "project",
        name: "Other project",
        description: "Other description",
        start: "2014-03",
        end: "2018-11",
      },
    ],
    [
      { kind: "skill", name: "Synthetic skill", firstUsed: null },
      { kind: "skill", name: "Other skill", firstUsed: "2013-02" },
    ],
    [
      {
        kind: "identity",
        fullName: "Synthetic Person",
        email: "synthetic@example.test",
        phone: "",
        links: [],
      },
      {
        kind: "identity",
        fullName: "Other Person",
        email: "other@example.test",
        phone: "123",
        links: [],
      },
    ],
    [
      { kind: "availability", earliestDate: null, noticeDays: null },
      { kind: "availability", earliestDate: "2037-05-17", noticeDays: 30 },
    ],
    [
      {
        kind: "work_authorization",
        country: "DE",
        currentlyAuthorized: "unknown",
        permitExpiresOn: null,
        futureSponsorship: "unknown",
        approvedWording: "",
      },
      {
        kind: "work_authorization",
        country: "DE",
        currentlyAuthorized: "yes",
        permitExpiresOn: "2037-05-17",
        futureSponsorship: "no",
        approvedWording: "Synthetic wording",
      },
    ],
  ];
  it.each(unsupported)("does not infer categories from unsupported changes %#", (before, after) => {
    expect(regressionsFromFactCorrection(fact(before), fact(after, 2))).toEqual([]);
    expect(regressionFromFactCorrection(fact(before), fact(after, 2))).toBeNull();
  });

  it.each(changes)(
    "requires exact identity, kind, key, increasing revision and both reviews for $variant",
    ({ before, after }) => {
      const oldFact = fact(before);
      const newFact = fact(after, 2);
      const pairs: [CandidateFact, CandidateFact][] = [
        [oldFact, { ...newFact, id: "other-synthetic-fact" }],
        [oldFact, { ...newFact, key: "other-synthetic-key" }],
        [oldFact, { ...newFact, value: before.kind === "language" ? metric : language }],
        [oldFact, { ...newFact, revision: 1 }],
        [{ ...oldFact, revision: 3 }, newFact],
        [{ ...oldFact, reviewedAt: null }, newFact],
        [oldFact, { ...newFact, reviewedAt: null }],
      ];
      for (const status of ["extracted", "owner_asserted", "conflicting", "expired"] as const) {
        pairs.push([{ ...oldFact, status }, newFact], [oldFact, { ...newFact, status }]);
      }
      for (const [invalidBefore, invalidAfter] of pairs) {
        expect(regressionsFromFactCorrection(invalidBefore, invalidAfter)).toEqual([]);
        expect(regressionFromFactCorrection(invalidBefore, invalidAfter)).toBeNull();
      }
    },
  );

  it("parses both facts strictly before classification", () => {
    const before = fact(employment);
    const after = fact({ ...employment, start: "2014-03" }, 2);
    const invalid = [
      null,
      {},
      { ...before, id: undefined },
      { ...before, key: undefined },
      { ...before, revision: 0 },
      { ...before, revision: 1.5 },
      { ...before, reviewedAt: "invalid-date" },
      { ...before, status: "unknown" },
      { ...before, privateText: "SYNTHETIC-PRIVATE-TEXT" },
      { ...before, provenance: { ...before.provenance, privateText: "SYNTHETIC-PRIVATE-TEXT" } },
      { ...before, value: { ...employment, privateText: "SYNTHETIC-PRIVATE-TEXT" } },
      { ...before, value: { ...employment, kind: "unknown" } },
      { ...before, value: { ...employment, start: "not-a-month" } },
      { ...before, value: { ...language, level: "unknown" } },
      { ...before, value: { ...metric, value: Number.POSITIVE_INFINITY } },
    ];
    for (const invalidFact of invalid) {
      for (const extract of [regressionsFromFactCorrection, regressionFromFactCorrection]) {
        expect(() => extract(invalidFact, after)).toThrow();
        expect(() => extract(before, invalidFact)).toThrow();
      }
    }
  });
});
