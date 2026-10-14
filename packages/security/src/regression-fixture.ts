import { createHash } from "node:crypto";
import { z } from "zod";
import { factSchema } from "../../contracts/src/candidate.js";
import { letterClaimReasonSchema } from "../../contracts/src/index.js";

const workload = z.enum(["full_time", "part_time"]);
export const regressionCorrectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workload_correction"),
      reviewed: z.literal(true),
      before: workload,
      after: workload,
    })
    .strict()
    .refine((value) => value.before !== value.after, {
      message: "Correction must change workload.",
    }),
  z
    .object({
      kind: z.literal("fact_correction"),
      reviewed: z.literal(true),
      variant: z.enum(["employment_period", "language_level", "metric_value"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unsupported_letter_claim"),
      reviewed: z.literal(true),
      variant: letterClaimReasonSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ambiguous_mail"),
      reviewed: z.literal(true),
      variant: z.literal("receipt_and_interview"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unsupported_form"),
      reviewed: z.literal(true),
      variant: z.literal("unsupported_required_control"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("adapter_drift"),
      reviewed: z.literal(true),
      variant: z.literal("changed_form_fingerprint"),
    })
    .strict(),
]);
export type RegressionCorrection = z.infer<typeof regressionCorrectionSchema>;

export function compileRegressionFixture(raw: unknown) {
  const correction = regressionCorrectionSchema.parse(raw);
  // Only enumerated public behavior crosses this boundary, never source identities/text.
  const fixture = { schemaVersion: 1 as const, ...correction };
  const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return { fixture, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function regressionFromFactCorrection(
  rawBefore: unknown,
  rawAfter: unknown,
): RegressionCorrection | null {
  return regressionsFromFactCorrection(rawBefore, rawAfter)[0] ?? null;
}

export function regressionsFromFactCorrection(
  rawBefore: unknown,
  rawAfter: unknown,
): RegressionCorrection[] {
  const before = factSchema.parse(rawBefore),
    after = factSchema.parse(rawAfter);
  if (
    before.id !== after.id ||
    before.key !== after.key ||
    before.value.kind !== after.value.kind ||
    after.revision <= before.revision ||
    before.status !== "verified" ||
    !before.reviewedAt ||
    after.status !== "verified" ||
    !after.reviewedAt
  )
    return [];
  const corrections: RegressionCorrection[] = [];
  if (before.value.kind === "employment" && after.value.kind === "employment") {
    if (before.value.workload !== after.value.workload)
      corrections.push({
        kind: "workload_correction",
        reviewed: true,
        before: before.value.workload,
        after: after.value.workload,
      });
    if (before.value.start !== after.value.start || before.value.end !== after.value.end)
      corrections.push({ kind: "fact_correction", reviewed: true, variant: "employment_period" });
  }
  if (
    before.value.kind === "language" &&
    after.value.kind === "language" &&
    before.value.level !== after.value.level
  )
    corrections.push({ kind: "fact_correction", reviewed: true, variant: "language_level" });
  if (
    before.value.kind === "metric" &&
    after.value.kind === "metric" &&
    before.value.value !== after.value.value
  )
    corrections.push({ kind: "fact_correction", reviewed: true, variant: "metric_value" });
  return corrections;
}

export function parseRegressionFixture(raw: unknown) {
  const record = z.record(z.string(), z.unknown()).parse(raw);
  const { schemaVersion, ...correction } = record;
  z.literal(1).parse(schemaVersion);
  return compileRegressionFixture(correction).fixture;
}

export function compileRegressionInput(raw: unknown) {
  const record = z.record(z.string(), z.unknown()).parse(raw);
  if (!Object.hasOwn(record, "schemaVersion")) return compileRegressionFixture(record);
  const { schemaVersion: _, ...correction } = parseRegressionFixture(record);
  return compileRegressionFixture(correction);
}
