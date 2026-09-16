import { PDFDocument, StandardFonts } from "pdf-lib";
import { ZipFile } from "yazl";

export async function syntheticDocx(
  body = '<w:p><w:r><w:t>Alex Example</w:t></w:r></w:p><w:p><w:hyperlink r:id="link1"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Python</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2020</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
) {
  const zip = new ZipFile();
  const entries = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    "word/_rels/document.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://synthetic.example/portfolio" TargetMode="External"/></Relationships>',
  };
  for (const [name, data] of Object.entries(entries))
    zip.addBuffer(Buffer.from(data), name, { mtime: new Date("2026-01-01T00:00:00Z") });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  zip.end();
  return result;
}
export async function syntheticPdf(blank = false) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const page = doc.addPage([595, 842]);
  if (!blank)
    page.drawText("Alex Example - Synthetic candidate\nPython engineer", {
      x: 50,
      y: 750,
      size: 14,
      font: await doc.embedFont(StandardFonts.Helvetica),
    });
  return Buffer.from(await doc.save());
}
