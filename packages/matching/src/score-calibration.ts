import { type FixedCalibration, fixedCalibrationSchema } from "../../contracts/src/calibration.js";

function ranks(values: number[]) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && sorted[end]?.value === sorted[start]?.value) end++;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index++) result[sorted[index]?.index as number] = rank;
    start = end;
  }
  return result;
}

export function scoreCalibration(raw: FixedCalibration) {
  const dataset = fixedCalibrationSchema.parse(raw);
  const samples = dataset.samples.filter((item) => !item.synthetic);
  const relevant = samples.filter((item) => item.relevant).length;
  const irrelevant = samples.length - relevant;
  const base = {
    datasetId: dataset.id,
    methodology: "fixed_owner_reviewed_binary_relevance_v1" as const,
    scope: "ranking_diagnostics_not_employer_outcomes" as const,
    advisoryOnly: true as const,
    routeSha256: dataset.routeSha256,
    compatibility: dataset.compatibility ?? null,
    window: { from: dataset.from, through: dataset.through, recordedAt: dataset.recordedAt },
    sampleSize: samples.length,
    relevant,
    irrelevant,
    minimumSample: 20,
    exclusions: { synthetic: dataset.samples.length - samples.length },
    limits: [
      "Owner labels are subjective, not independent ground truth.",
      "One fixed dataset does not establish out-of-sample performance.",
      "No ranking weights or authorization are changed.",
      "Provider-reported model names do not identify immutable upstream model builds.",
      ...(!dataset.compatibility?.pipelineVersion
        ? ["Legacy scores have no recorded matching pipeline version."]
        : []),
    ],
  };
  if (samples.length < 20)
    return { ...base, status: "insufficient_data" as const, metrics: null, bands: null };
  if (!relevant || !irrelevant)
    return { ...base, status: "insufficient_label_variation" as const, metrics: null, bands: null };
  const scoreRanks = ranks(samples.map((item) => item.score));
  const labelRanks = ranks(samples.map((item) => Number(item.relevant)));
  const mean = (samples.length + 1) / 2;
  let covariance = 0,
    scoreVariance = 0,
    labelVariance = 0,
    relevantRankSum = 0;
  for (let index = 0; index < samples.length; index++) {
    const x = (scoreRanks[index] as number) - mean;
    const y = (labelRanks[index] as number) - mean;
    covariance += x * y;
    scoreVariance += x * x;
    labelVariance += y * y;
    if (samples[index]?.relevant) relevantRankSum += scoreRanks[index] as number;
  }
  if (scoreVariance === 0)
    return { ...base, status: "insufficient_score_variation" as const, metrics: null, bands: null };
  const bands = [
    [0, 40],
    [40, 70],
    [70, 101],
  ].map(([lower, upper]) => {
    const members = samples.filter(
      (item) => item.score >= (lower as number) && item.score < (upper as number),
    );
    return {
      lowerInclusive: lower,
      upperExclusive: upper,
      sampleSize: members.length,
      relevant: members.filter((item) => item.relevant).length,
    };
  });
  return {
    ...base,
    status: "measured" as const,
    metrics: {
      spearmanRankCorrelation: covariance / Math.sqrt(scoreVariance * labelVariance),
      relevanceDiscriminationAuc:
        (relevantRankSum - (relevant * (relevant + 1)) / 2) / (relevant * irrelevant),
    },
    bands,
  };
}
