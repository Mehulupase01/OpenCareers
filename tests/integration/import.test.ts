import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { extractDocument } from "../../packages/candidate/src/extract.js";
import { CandidateImporter, parseIsolated } from "../../packages/candidate/src/import.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { syntheticDocx, syntheticPdf } from "../helpers/document-fixtures.js";

it("preserves DOCX paragraphs, table cells, hyperlinks and original source bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencareers-import-"));
  const db = await openSqlite(join(dir, "test.sqlite"));
  try {
    await migrate(db);
    const repo = new CandidateRepository(db, "synthetic-owner");
    await repo.initialize();
    const importer = new CandidateImporter(repo, dir);
    const bytes = await syntheticDocx();
    const before = createHash("sha256").update(bytes).digest("hex");
    const source = await importer.import(bytes, "synthetic.docx");
    expect(source.blocks.some((b) => b.kind === "table_cell" && b.text === "Python")).toBe(true);
    expect(
      source.blocks.some(
        (b) => b.kind === "link" && b.url === "https://synthetic.example/portfolio",
      ),
    ).toBe(true);
    expect(source.sha256).toBe(before);
    const stored = (await db.query("SELECT storage_key FROM candidate_sources"))[0];
    expect(await readFile(join(dir, String(stored?.storage_key)))).toEqual(bytes);
    expect((await importer.import(bytes, "duplicate.docx")).id).toBe(source.id);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
it("retains PDF page coordinates and explicitly identifies unreadable pages", async () => {
  const parsed = await parseIsolated(await syntheticPdf(), "pdf");
  expect(
    parsed.blocks.some(
      (b) =>
        b.text.includes("Alex Example") && b.locator.startsWith("page:1") && b.bounds?.length === 4,
    ),
  ).toBe(true);
  expect(parsed.quality).toBe("review_required");
  const blank = await parseIsolated(await syntheticPdf(true), "pdf");
  expect(blank.quality).toBe("unreadable");
  expect(blank.warnings.length).toBeGreaterThan(0);
}, 30000);
it("canonicalizes the trusted root but rejects redirected source subdirectories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencareers-path-"));
  const db = await openSqlite(":memory:");
  try {
    await migrate(db);
    const repo = new CandidateRepository(db, "synthetic-owner");
    await repo.initialize();
    const physical = join(dir, "physical-root");
    const alias = join(dir, "root-alias");
    const redirected = join(dir, "redirected-root");
    await mkdir(physical);
    await mkdir(redirected);
    await symlink(physical, alias, process.platform === "win32" ? "junction" : "dir");
    const bytes = await syntheticDocx();
    expect(
      (await new CandidateImporter(repo, alias).import(bytes, "synthetic.docx")).sha256,
    ).toHaveLength(64);
    await symlink(
      join(physical, "candidate-sources"),
      join(redirected, "candidate-sources"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      new CandidateImporter(repo, redirected).import(bytes, "synthetic.docx"),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
it("rejects malformed, oversized, entity-bearing and timed-out parser inputs", async () => {
  await expect(extractDocument(Buffer.from("not a PDF"), "pdf")).rejects.toThrow();
  await expect(parseIsolated(Buffer.alloc(11 * 1024 * 1024), "docx")).rejects.toThrow();
  await expect(
    extractDocument(
      await syntheticDocx('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private">]><w:p>&x;</w:p>'),
      "docx",
    ),
  ).rejects.toThrow();
  await expect(parseIsolated(await syntheticDocx(), "docx", 1)).rejects.toMatchObject({
    code: "CONFIG_INVALID",
  });
});
