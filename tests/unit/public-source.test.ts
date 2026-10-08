import { describe, expect, it } from "vitest";
import { publicSourceFindings } from "../../packages/security/src/public-source.js";

describe("public source inventory", () => {
  it("refuses PDF and DOCX documents instead of skipping their private content", () => {
    for (const path of ["docs/masterplan.pdf", "docs/resume.DOCX", "docs\\private-policy.PDF"])
      expect(publicSourceFindings(path, Buffer.from("binary"))).toEqual([
        "unreviewed binary document; keep private or generate a synthetic fixture",
      ]);
  });
  it("rejects private paths even for image files", () => {
    expect(publicSourceFindings("browser-state/session.png", Buffer.from("image"))).toEqual([
      "forbidden private path",
    ]);
    expect(publicSourceFindings(".env.local", Buffer.from("CONFIG=example"))).toEqual([
      "forbidden private path",
    ]);
  });
  it("detects credential-shaped text without returning its contents", () => {
    const fake = `${["sk", "or", "v1"].join("-")}-${"a".repeat(64)}`;
    expect(publicSourceFindings("config.ts", Buffer.from(fake))).toEqual([
      "credential-like content",
    ]);
  });
  it("accepts public examples and visual assets", () => {
    expect(publicSourceFindings(".env.example", Buffer.from("TOKEN=replace-me"))).toEqual([]);
    expect(publicSourceFindings("assets/logo.png", Buffer.from("image"))).toEqual([]);
  });
  it("accepts only the reviewed bytes of synthetic document goldens", async () => {
    for (const kind of ["cv", "letter"])
      for (const format of ["pdf", "docx"]) {
        const path = `docs/evidence/goldens/P06/synthetic-${kind}.${format}`;
        expect(publicSourceFindings(path, await readFile(path))).toEqual([]);
        expect(publicSourceFindings(path, Buffer.from("private replacement"))).not.toEqual([]);
      }
  });
});

import { readFile } from "node:fs/promises";
