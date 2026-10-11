import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { compileRegressionInput } from "../packages/security/src/regression-fixture.js";

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return (
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
};

export async function importRegressionFixture(root: string, input: string, reviewed: boolean) {
  if (!reviewed) throw new Error("Reviewed fixture publication is required.");
  const repo = await realpath(root);
  const parent = await realpath(join(repo, "tests", "fixtures"));
  if (!inside(repo, parent) || parent !== join(repo, "tests", "fixtures"))
    throw new Error("Fixture parent escaped its approved directory.");
  const handle = await open(resolve(input), "r");
  let compiled: ReturnType<typeof compileRegressionInput>;
  try {
    if (!(await handle.stat()).isFile())
      throw new Error("Correction input must be a regular file.");
    const buffer = Buffer.alloc(16385);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > 16384) throw new Error("Correction input exceeds its bound.");
    compiled = compileRegressionInput(JSON.parse(buffer.subarray(0, total).toString("utf8")));
  } finally {
    await handle.close();
  }
  const folder = join(parent, "regressions");
  await mkdir(folder, { recursive: true });
  const canonical = await realpath(folder);
  if (!inside(repo, canonical) || canonical !== folder)
    throw new Error("Fixture output is redirected.");
  const output = join(canonical, `${compiled.sha256}.json`);
  try {
    const target = await open(output, "wx", 0o600);
    try {
      await target.writeFile(compiled.bytes);
    } finally {
      await target.close();
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    const stat = await lstat(output);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== compiled.bytes.length ||
      (await realpath(output)) !== output
    )
      throw new Error("Existing fixture bytes do not match.");
    const existing = await open(output, "r");
    try {
      const buffer = Buffer.alloc(compiled.bytes.length + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await existing.read(buffer, total, buffer.length - total, null);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (!buffer.subarray(0, total).equals(compiled.bytes))
        throw new Error("Existing fixture bytes do not match.");
    } finally {
      await existing.close();
    }
  }
  return {
    filename: `${compiled.sha256}.json`,
    sha256: compiled.sha256,
    kind: compiled.fixture.kind,
  };
}
