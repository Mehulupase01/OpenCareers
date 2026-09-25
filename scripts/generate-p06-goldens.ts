import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generatePacketContent } from "../packages/documents/src/domain.js";
import { equivalenceIssues, extractDocx, extractPdf } from "../packages/documents/src/extract.js";
import {
  renderCvDocx,
  renderCvPdf,
  renderLetterDocx,
  renderLetterPdf,
} from "../packages/documents/src/render.js";
import { validatePacketContent } from "../packages/documents/src/validation.js";
import { documentGenerationInput } from "../tests/fixtures/document-packets.js";

const output = resolve("docs/evidence/goldens/P06");
await mkdir(output, { recursive: true });
const input = { ...documentGenerationInput(), requestedAnswers: [] };
const content = generatePacketContent(input);
const artifacts = {
  "synthetic-cv.docx": await renderCvDocx(content.cv, content.generatedAt),
  "synthetic-cv.pdf": await renderCvPdf(content.cv, content.generatedAt),
  "synthetic-letter.docx": await renderLetterDocx(
    content.letter,
    content.cv.identity.fullName,
    content.generatedAt,
  ),
  "synthetic-letter.pdf": await renderLetterPdf(
    content.letter,
    content.cv.identity.fullName,
    content.generatedAt,
  ),
  "synthetic-answers.json": Buffer.from(`${JSON.stringify(content.answers, null, 2)}\n`),
};
for (const [name, buffer] of Object.entries(artifacts))
  await writeFile(resolve(output, name), buffer);
const [cvDocx, cvPdf, letterDocx, letterPdf] = await Promise.all([
  extractDocx(artifacts["synthetic-cv.docx"]),
  extractPdf(artifacts["synthetic-cv.pdf"]),
  extractDocx(artifacts["synthetic-letter.docx"]),
  extractPdf(artifacts["synthetic-letter.pdf"]),
]);
const validation = validatePacketContent({
  content,
  profile: input.profile,
  assessment: input.assessment,
  asOf: input.asOf,
  checkedAt: input.generatedAt,
});
const report = {
  generatedAt: input.generatedAt,
  syntheticOnly: true,
  validation,
  formatIssues: equivalenceIssues(content, cvDocx, cvPdf, letterDocx, letterPdf),
  documents: {
    cv: {
      docxCharacters: cvDocx.text.length,
      pdfCharacters: cvPdf.text.length,
      pages: cvPdf.pages,
    },
    letter: {
      docxCharacters: letterDocx.text.length,
      pdfCharacters: letterPdf.text.length,
      pages: letterPdf.pages,
    },
  },
  artifacts: Object.fromEntries(
    Object.entries(artifacts).map(([name, buffer]) => [
      name,
      { bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") },
    ]),
  ),
};
await writeFile(resolve(output, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`);
if (validation.status !== "valid" || report.formatIssues.length)
  throw new Error("P06 golden packet failed validation.");
