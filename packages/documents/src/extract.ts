import { XMLParser } from "fast-xml-parser";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import yauzl from "yauzl";
import type { PacketContent, ValidationIssue } from "../../contracts/src/documents.js";

export interface ExtractedDocument {
  text: string;
  pages: number;
  issues: ValidationIssue[];
}

const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();
const readZipEntry = (buffer: Buffer, wanted: string) =>
  new Promise<{ data: Buffer | null; entries: string[] }>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip)
        return reject(openError ?? new Error("DOCX archive could not be opened."));
      const entries: string[] = [];
      let data: Buffer | null = null;
      zip.on("entry", (entry) => {
        entries.push(entry.fileName);
        if (entry.fileName !== wanted) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream)
            return reject(streamError ?? new Error("DOCX entry could not be read."));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            data = Buffer.concat(chunks);
            zip.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => resolve({ data, entries }));
      zip.on("error", reject);
      zip.readEntry();
    });
  });

function xmlText(nodes: unknown): string[] {
  if (Array.isArray(nodes)) return nodes.flatMap(xmlText);
  if (!nodes || typeof nodes !== "object") return [];
  return Object.entries(nodes as Record<string, unknown>).flatMap(([key, value]) =>
    key === "#text" && (typeof value === "string" || typeof value === "number")
      ? [String(value)]
      : xmlText(value),
  );
}

export async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const issues: ValidationIssue[] = [];
  const { data, entries } = await readZipEntry(buffer, "word/document.xml");
  if (!data)
    issues.push({
      code: "FORMAT_INVALID",
      severity: "error",
      path: "docx",
      message: "DOCX does not contain word/document.xml.",
    });
  if (
    entries.some(
      (entry) =>
        /vbaProject\.bin$/i.test(entry) ||
        /activeX/i.test(entry) ||
        /embeddings\//i.test(entry) ||
        entry.startsWith("../") ||
        entry.includes("/../"),
    )
  )
    issues.push({
      code: "FORMAT_INVALID",
      severity: "error",
      path: "docx",
      message: "DOCX contains executable, embedded or unsafe-path content.",
    });
  const parsed = data
    ? new XMLParser({ preserveOrder: true, ignoreAttributes: false }).parse(data.toString("utf8"))
    : [];
  return { text: normalize(xmlText(parsed).join(" ")), pages: 0, issues };
}

export async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  const issues: ValidationIssue[] = [];
  const loading = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  const document = await loading.promise;
  const text: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text.push(item.str);
      const [a, b, c, d, x, y] = item.transform;
      const height = Math.max(Math.abs(b ?? 0), Math.abs(d ?? 0), item.height ?? 0);
      const width = item.width ?? Math.abs(a ?? 0) + Math.abs(c ?? 0);
      if (
        x === undefined ||
        y === undefined ||
        x < 0 ||
        y - height < -0.5 ||
        x + width > viewport.width + 0.5 ||
        y > viewport.height + 0.5
      )
        issues.push({
          code: "LAYOUT_INVALID",
          severity: "error",
          path: `pdf.page.${pageNumber}`,
          message: "PDF text extends outside the page bounds.",
        });
    }
  }
  await loading.destroy();
  return { text: normalize(text.join(" ")), pages: document.numPages, issues };
}

export function equivalenceIssues(
  content: PacketContent,
  cvDocx: ExtractedDocument,
  cvPdf: ExtractedDocument,
  letterDocx: ExtractedDocument,
  letterPdf: ExtractedDocument,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cvAnchors = [
    content.cv.identity.fullName,
    content.cv.identity.email,
    content.cv.identity.phone,
    content.cv.summary.text,
    ...content.cv.employment.flatMap((entry) => [
      entry.employer,
      entry.title,
      entry.start,
      entry.end ?? "Present",
      ...entry.bullets.map((claim) => claim.text),
    ]),
    ...content.cv.education.flatMap((entry) => [
      entry.institution,
      entry.qualification,
      entry.start,
      entry.end ?? "Present",
    ]),
    ...content.cv.skills.map((claim) => claim.text.replace(/\.$/, "")),
    ...content.cv.languages.map((claim) => claim.text.replace(/\.$/, "")),
  ];
  const letterAnchors = [
    content.job.company,
    content.job.role,
    content.letter.opening,
    ...content.letter.contributions.map((claim) => claim.text),
    content.letter.motivation,
  ];
  for (const [label, anchors, left, right] of [
    ["cv", cvAnchors, cvDocx.text, cvPdf.text],
    ["letter", letterAnchors, letterDocx.text, letterPdf.text],
  ] as const) {
    for (const anchor of anchors.map(normalize)) {
      if (!left.includes(anchor) || !right.includes(anchor))
        issues.push({
          code: "CONTENT_MISMATCH",
          severity: "error",
          path: label,
          message: `${label.toUpperCase()} DOCX/PDF is missing bound content: ${anchor.slice(0, 120)}`,
        });
    }
  }
  return [...cvDocx.issues, ...cvPdf.issues, ...letterDocx.issues, ...letterPdf.issues, ...issues];
}
