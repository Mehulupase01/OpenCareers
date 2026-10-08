import { createHash } from "node:crypto";
import { extname } from "node:path";

// Reviewed P06 synthetic goldens. A filename alone never authorizes new bytes.
const reviewedDocuments = new Map([
  [
    "docs/evidence/goldens/P06/synthetic-cv.docx",
    "1b3d19bd839dccac67401e4ea52510028f7a6898700261c94871c2adf7c48805",
  ],
  [
    "docs/evidence/goldens/P06/synthetic-cv.pdf",
    "e2a1957845873a333315b819b89e39653ea7541d69dd744cc36c013a0c70b6e8",
  ],
  [
    "docs/evidence/goldens/P06/synthetic-letter.docx",
    "92952249b2e0a8919a79d8318ef8d03163d05cf67ee661fea6aecb3c98035364",
  ],
  [
    "docs/evidence/goldens/P06/synthetic-letter.pdf",
    "aa04ef340321a505df025557bcf205e6843e71f6dd4b47df63d3e50bf4cb4a70",
  ],
]);

const credentialPatterns = [
  /sk-or-v1-[a-f0-9]{32,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /ya29\.[A-Za-z0-9_-]{40,}/,
];

export function publicSourceFindings(file: string, bytes: Buffer): string[] {
  const path = file.replaceAll("\\", "/");
  const findings: string[] = [];
  if (
    /(?:^|\/)(?:private|browser-state|artifacts-private)\//.test(path) ||
    (/(?:^|\/)\.env(?:\.|$)/.test(path) && path !== ".env.example")
  )
    findings.push("forbidden private path");
  const extension = extname(path).toLowerCase();
  // Binary documents cannot be certified public by a plaintext credential regex.
  if ([".pdf", ".docx"].includes(extension)) {
    if (reviewedDocuments.get(path) !== createHash("sha256").update(bytes).digest("hex"))
      findings.push("unreviewed binary document; keep private or generate a synthetic fixture");
    return findings;
  }
  if ([".png", ".jpg", ".woff2"].includes(extension)) return findings;
  if (credentialPatterns.some((pattern) => pattern.test(bytes.toString("utf8"))))
    findings.push("credential-like content");
  return findings;
}
