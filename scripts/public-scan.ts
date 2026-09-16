import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const patterns = [
  /sk-or-v1-[a-f0-9]{32,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /ya29\.[A-Za-z0-9_-]{40,}/,
];
const findings: string[] = [];
for (const file of files) {
  if (
    /(?:^|\/)(?:private|browser-state|artifacts-private)\//.test(file) ||
    (/(?:^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example")
  )
    findings.push(`${file}: forbidden private path`);
  const extension = extname(file);
  if ([".png", ".jpg", ".woff2", ".pdf", ".docx"].includes(extension)) continue;
  const content = await readFile(file, "utf8");
  if (patterns.some((pattern) => pattern.test(content)))
    findings.push(`${file}: credential-like content`);
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Public-source scan passed: ${files.length} files. Pattern scan does not replace private-data review.`,
  );
