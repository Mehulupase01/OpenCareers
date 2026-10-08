import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { publicSourceFindings } from "../packages/security/src/public-source.js";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const findings: string[] = [];
for (const file of files) {
  for (const finding of publicSourceFindings(file, await readFile(file)))
    findings.push(`${file}: ${finding}`);
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Public-source scan passed: ${files.length} files. Pattern scan does not replace private-data review.`,
  );
