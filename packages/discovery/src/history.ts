import { parse } from "csv-parse/sync";
import { z } from "zod";
import { type HistoryRecord, historyRecordSchema } from "../../contracts/src/discovery.js";

export function parseHistory(body: string, format: "json" | "csv"): HistoryRecord[] {
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error("History exceeds 2 MiB.");
  if (format === "json") return z.array(historyRecordSchema).max(2000).parse(JSON.parse(body));
  const records: unknown[] = parse(body, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    max_record_size: 65536,
  });
  const rows = z
    .array(
      z
        .object({
          externalId: z.string(),
          url: z.string(),
          company: z.string(),
          title: z.string(),
          location: z.string().optional(),
          submitted: z.enum(["true", "false"]),
          submittedOn: z.string(),
          ownerAssertion: z.string(),
          documents: z.string().optional(),
        })
        .strict(),
    )
    .max(2000)
    .parse(records);
  return rows.map((row) =>
    historyRecordSchema.parse({
      ...row,
      submitted: row.submitted === "true",
      submittedOn: row.submittedOn || null,
      documents: row.documents ? JSON.parse(row.documents) : [],
    }),
  );
}
