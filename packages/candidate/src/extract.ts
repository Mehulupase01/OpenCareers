import { basename } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { type Entry, fromBuffer, type ZipFile } from "yauzl";
import { type Extraction, extractionSchema } from "../../contracts/src/candidate.js";

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED = 32 * 1024 * 1024;
function safeUrl(input: unknown): string | null {
  try {
    const url = new URL(String(input));
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function collector(format: Extraction["format"], parserVersion: string) {
  const blocks: Extraction["blocks"] = [];
  const warnings = new Set<string>();
  let characters = 0;
  return {
    blocks,
    warnings,
    add(block: Extraction["blocks"][number]) {
      characters += block.text.length;
      if (characters > 500000 || blocks.length >= 20000 || block.text.length > 10000)
        throw new Error("Extraction exceeds text limits.");
      if (block.text.trim() || block.url) blocks.push(block);
    },
    finish(): Extraction {
      if (!blocks.some((b) => b.kind !== "link" && b.text.trim()))
        warnings.add("No readable text. A reviewed transcription or OCR import is required.");
      return extractionSchema.parse({
        format,
        parserVersion,
        blocks,
        warnings: [...warnings].slice(0, 200),
        quality: blocks.some((b) => b.kind !== "link" && b.text.trim())
          ? "review_required"
          : "unreadable",
      });
    },
  };
}
async function zipParts(bytes: Buffer): Promise<Map<string, string>> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) =>
        error || !zip ? reject(error ?? new Error("Invalid archive.")) : resolve(zip),
    ),
  );
  return new Promise((resolve, reject) => {
    const parts = new Map<string, string>();
    const names = new Set<string>();
    let expanded = 0;
    let entries = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      entries++;
      expanded += entry.uncompressedSize;
      if (
        entries > 1000 ||
        expanded > MAX_EXPANDED ||
        entry.uncompressedSize > 8 * 1024 * 1024 ||
        names.has(entry.fileName) ||
        entry.isEncrypted() ||
        /vbaProject|embeddings\//i.test(entry.fileName)
      )
        return fail(new Error("Archive exceeds limits or contains unsupported active content."));
      names.add(entry.fileName);
      if (!entry.fileName.endsWith(".xml") && !entry.fileName.endsWith(".rels")) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(error ?? new Error("Archive entry unavailable."));
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("error", fail);
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > entry.uncompressedSize || size > 8 * 1024 * 1024) {
            stream.destroy();
            fail(new Error("Archive size mismatch."));
          } else chunks.push(chunk);
        });
        stream.on("end", () => {
          if (settled) return;
          parts.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
          zip.readEntry();
        });
      });
    });
    zip.on("end", () => {
      if (!settled) {
        settled = true;
        zip.close();
        resolve(parts);
      }
    });
    zip.readEntry();
  });
}
type XmlNode = Record<string, unknown>;
const children = (value: unknown): XmlNode[] => (Array.isArray(value) ? (value as XmlNode[]) : []);
function xml(input: string): XmlNode[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(input) || XMLValidator.validate(input) !== true)
    throw new Error("Unsafe or malformed XML.");
  return new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
    processEntities: true,
  }).parse(input) as XmlNode[];
}
function textOf(nodes: XmlNode[], depth = 0): string {
  if (depth > 120) throw new Error("XML nesting limit exceeded.");
  return nodes
    .map((node) =>
      Object.entries(node)
        .map(([tag, value]) =>
          tag === "#text"
            ? String(value)
            : tag === "tab"
              ? "\t"
              : ["br", "cr"].includes(tag)
                ? "\n"
                : tag === ":@"
                  ? ""
                  : textOf(children(value), depth + 1),
        )
        .join(""),
    )
    .join("");
}
async function docx(bytes: Buffer): Promise<Extraction> {
  const parts = await zipParts(bytes);
  if (!parts.has("word/document.xml") || !parts.has("[Content_Types].xml"))
    throw new Error("Not a DOCX document.");
  const result = collector("docx", "fast-xml-parser@5.11.1;yauzl@3.4.0");
  for (const [part, source] of parts) {
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(part)) continue;
    const relationships = new Map<string, string>();
    const rels = parts.get(`word/_rels/${basename(part)}.rels`);
    if (rels) {
      const walkRels = (nodes: XmlNode[]) => {
        for (const node of nodes)
          for (const [tag, value] of Object.entries(node)) {
            if (tag === "Relationship") {
              const attrs = node[":@"] as Record<string, unknown> | undefined;
              const url = safeUrl(attrs?.["@_Target"]);
              if (url && String(attrs?.["@_Type"]).endsWith("/hyperlink"))
                relationships.set(String(attrs?.["@_Id"]), url);
            } else if (tag !== ":@") walkRels(children(value));
          }
      };
      walkRels(xml(rels));
    }
    const walk = (nodes: XmlNode[], path: string, depth = 0) => {
      if (depth > 120) throw new Error("XML nesting limit exceeded.");
      const counts = new Map<string, number>();
      for (const node of nodes)
        for (const [tag, value] of Object.entries(node)) {
          if (tag === ":@" || tag === "#text") continue;
          const index = (counts.get(tag) ?? 0) + 1;
          counts.set(tag, index);
          const locator = `${path}/${tag}[${index}]`;
          if (tag === "p")
            result.add({
              locator,
              kind: path.includes("/tc[") ? "table_cell" : "paragraph",
              text: textOf(children(value)),
              url: null,
              bounds: null,
            });
          if (tag === "hyperlink") {
            const attrs = node[":@"] as Record<string, unknown> | undefined;
            const url = relationships.get(String(attrs?.["@_id"]));
            if (url)
              result.add({
                locator,
                kind: "link",
                text: textOf(children(value)),
                url,
                bounds: null,
              });
          }
          if (["drawing", "pict", "altChunk", "object", "del", "ins"].includes(tag))
            result.warnings.add(
              `Document contains ${tag} content; verify its representation against the original.`,
            );
          walk(children(value), locator, depth + 1);
        }
    };
    walk(xml(source), part);
  }
  result.warnings.add(
    "Extracted content requires owner review before becoming a usable candidate fact.",
  );
  return result.finish();
}
async function pdf(bytes: Buffer): Promise<Extraction> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const result = collector("pdf", `pdfjs-dist@${pdfjs.version}`);
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    stopAtErrors: true,
    useWorkerFetch: false,
    useWasm: false,
    enableXfa: false,
    disableFontFace: true,
  });
  try {
    const doc = await loading.promise;
    if (doc.numPages > 60) throw new Error("PDF page limit exceeded.");
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let itemNumber = 0;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        itemNumber++;
        result.add({
          locator: `page:${pageNumber}/item:${itemNumber}`,
          kind: "page_line",
          text: item.str,
          url: null,
          bounds: [item.transform[4], item.transform[5], item.width, item.height],
        });
      }
      const annotations = await page.getAnnotations();
      for (let i = 0; i < annotations.length; i++) {
        const annotation = annotations[i];
        const url = safeUrl(annotation?.url);
        if (url)
          result.add({
            locator: `page:${pageNumber}/annotation:${i + 1}`,
            kind: "link",
            text: url,
            url,
            bounds: null,
          });
      }
      if (!content.items.length)
        result.warnings.add(`Page ${pageNumber} has no extracted text; verify scans and images.`);
      page.cleanup();
    }
    result.warnings.add(
      "PDF reading order and table relationships need visual review. Page item coordinates are retained.",
    );
    return result.finish();
  } finally {
    await loading.destroy();
  }
}
export async function extractDocument(bytes: Buffer, format: "pdf" | "docx"): Promise<Extraction> {
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES)
    throw new Error("Source size limit exceeded.");
  if (format === "pdf" && bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new Error("PDF signature mismatch.");
  if (format === "docx" && bytes.readUInt16LE(0) !== 0x4b50)
    throw new Error("DOCX signature mismatch.");
  return format === "pdf" ? pdf(bytes) : docx(bytes);
}
