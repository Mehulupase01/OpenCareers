import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FixedCalibration } from "../../packages/contracts/src/calibration.js";
import { scoreCalibration } from "../../packages/matching/src/score-calibration.js";

const fixture = (): FixedCalibration => ({
  id: randomUUID(),
  from: "2026-09-01T00:00:00.000Z",
  through: "2026-09-30T00:00:00.000Z",
  recordedAt: "2026-10-01T00:00:00.000Z",
  routeSha256: "a".repeat(64),
  samples: Array.from({ length: 20 }, (_, index) => ({
    assessmentId: `assessment-${index}`,
    assessmentSha256: "b".repeat(64),
    jobId: `job-${index}`,
    score: index < 10 ? 20 : 80,
    relevant: index >= 10,
    synthetic: false,
    reviewedAt: "2026-09-20T00:00:00.000Z",
    evidenceRef: `synthetic-evidence-${index}`,
    evidenceSha256: "c".repeat(64),
  })),
});
describe("fixed reviewed-relevance diagnostics", () => {
  it("keeps legacy pipeline history explicitly unrecorded", () => {
    const report = scoreCalibration(fixture());
    expect(report.compatibility).toBeNull();
    expect(report.limits).toContain("Legacy scores have no recorded matching pipeline version.");
    const compatibility = {
      modelId: null,
      provider: null,
      pipelineVersion: "evidence-matching-v1",
      profileId: "synthetic-profile",
    };
    const known = scoreCalibration({ ...fixture(), compatibility });
    expect(known.compatibility).toEqual(compatibility);
    expect(known.limits).not.toContain("Legacy scores have no recorded matching pipeline version.");
  });
  it("refuses small, synthetic-only and degenerate datasets", () => {
    const data = fixture();
    expect(scoreCalibration({ ...data, samples: data.samples.slice(0, 19) })).toMatchObject({
      status: "insufficient_data",
      sampleSize: 19,
      metrics: null,
    });
    expect(
      scoreCalibration({ ...data, samples: data.samples.map((s) => ({ ...s, synthetic: true })) }),
    ).toMatchObject({
      status: "insufficient_data",
      sampleSize: 0,
      exclusions: { synthetic: 20 },
      metrics: null,
    });
    expect(
      scoreCalibration({ ...data, samples: data.samples.map((s) => ({ ...s, relevant: true })) }),
    ).toMatchObject({ status: "insufficient_label_variation", metrics: null });
    expect(
      scoreCalibration({ ...data, samples: data.samples.map((s) => ({ ...s, score: 50 })) }),
    ).toMatchObject({ status: "insufficient_score_variation", metrics: null });
  });
  it("measures perfect and reversed ranks with ties, not hiring likelihood", () => {
    const data = fixture();
    const report = scoreCalibration(data);
    expect(report).toMatchObject({
      status: "measured",
      sampleSize: 20,
      relevant: 10,
      irrelevant: 10,
      advisoryOnly: true,
      metrics: { spearmanRankCorrelation: 1, relevanceDiscriminationAuc: 1 },
    });
    expect(
      scoreCalibration({
        ...data,
        samples: data.samples.map((s) => ({ ...s, score: 100 - s.score })),
      }).metrics,
    ).toEqual({ spearmanRankCorrelation: -1, relevanceDiscriminationAuc: 0 });
    expect(JSON.stringify(report)).not.toMatch(/probability|chance|forecast/);
    expect(report.bands?.reduce((sum, band) => sum + band.sampleSize, 0)).toBe(20);
    expect(report.window).toEqual({
      from: data.from,
      through: data.through,
      recordedAt: data.recordedAt,
    });
  });
  it("agrees with a pairwise discrimination oracle on tied shuffled scores", () => {
    const data = fixture();
    data.samples.forEach((s, index) => {
      s.score = ((index * 7) % 13) * 5;
      s.relevant = index % 3 === 0;
    });
    const positive = data.samples.filter((s) => s.relevant),
      negative = data.samples.filter((s) => !s.relevant);
    let wins = 0;
    for (const a of positive)
      for (const b of negative) wins += a.score > b.score ? 1 : a.score === b.score ? 0.5 : 0;
    expect(scoreCalibration(data).metrics?.relevanceDiscriminationAuc).toBeCloseTo(
      wins / (positive.length * negative.length),
      12,
    );
  });
});
