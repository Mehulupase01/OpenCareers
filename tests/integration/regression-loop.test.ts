import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { chronology } from "../../packages/candidate/src/domain.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { compileLetterProposal } from "../../packages/documents/src/letter-draft.js";
import { classifyMail } from "../../packages/email/src/correlation.js";
import {
  compileRegressionFixture,
  parseRegressionFixture,
  regressionFromFactCorrection,
} from "../../packages/security/src/regression-fixture.js";
import { importRegressionFixture } from "../../scripts/regression-import.js";
import { documentFacts, documentGenerationInput } from "../fixtures/document-packets.js";

function verify(raw: unknown) {
  const fixture = parseRegressionFixture(raw);
  if (fixture.kind === "workload_correction") {
    const base = documentFacts.find((fact) => fact.id === "fact-employment-full");
    if (base?.value.kind !== "employment") throw new Error("Missing fixture fact.");
    const corrected = {
      ...base,
      value: {
        ...base.value,
        employer: "Synthetic Regression Employer",
        start: "2022-01",
        end: "2022-12",
        workload: fixture.after,
      },
    };
    expect(chronology([corrected], "2026-09-17")).toMatchObject({
      totalMonths: 12,
      fullTimeMonths: fixture.after === "full_time" ? 12 : 0,
      partTimeMonths: fixture.after === "part_time" ? 12 : 0,
    });
  } else if (fixture.kind === "unsupported_letter_claim") {
    const input = documentGenerationInput(),
      content = generatePacketContent(input);
    expect(() =>
      compileLetterProposal(input, content, {
        opening: content.letter.opening,
        motivation: "I built 100 production systems using Python.",
        contributionIds: [content.letter.contributions[0]?.id ?? "missing"],
      }),
    ).toThrow("unsupported claims");
  } else {
    expect(
      classifyMail({
        id: "synthetic-regression-mail",
        receivedAt: "2026-09-17T00:00:00.000Z",
        sender: "recruiter@synthetic.example",
        recipients: ["candidate@synthetic.example"],
        authenticatedDomain: "synthetic.example",
        subject: "Application received",
        text: "We received your application. Interview invitation.",
      }),
    ).toBe("ambiguous");
  }
}
describe("correction to executable synthetic regression", () => {
  it("refuses redirected output and runs the sanitized CLI without exposing input", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-regression-cli-")));
    try {
      const fixtures = join(root, "tests", "fixtures");
      await mkdir(fixtures, { recursive: true });
      const input = join(root, "private-correction.json");
      await writeFile(
        input,
        JSON.stringify({
          kind: "ambiguous_mail",
          reviewed: true,
          variant: "receipt_and_interview",
        }),
      );
      const execute = promisify(execFile);
      const cli = [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("scripts/import-regression.ts"),
        input,
        "--publish-reviewed",
      ];
      const { stdout } = await execute(process.execPath, cli, { cwd: root });
      const result = JSON.parse(stdout);
      expect(result.kind).toBe("ambiguous_mail");
      expect(stdout).not.toContain(root);
      verify(JSON.parse(await readFile(join(fixtures, "regressions", result.filename), "utf8")));
      await writeFile(
        input,
        JSON.stringify({
          kind: "ambiguous_mail",
          reviewed: true,
          variant: "receipt_and_interview",
          candidateName: "Pat Example",
        }),
      );
      await expect(execute(process.execPath, cli, { cwd: root })).rejects.toMatchObject({
        stdout: "",
        stderr: expect.stringContaining("Regression import refused"),
      });
      await rm(join(fixtures, "regressions"), { recursive: true });
      const redirected = join(root, "redirected");
      await mkdir(redirected);
      await symlink(
        redirected,
        join(fixtures, "regressions"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await writeFile(
        input,
        JSON.stringify({
          kind: "ambiguous_mail",
          reviewed: true,
          variant: "receipt_and_interview",
        }),
      );
      await expect(importRegressionFixture(root, input, true)).rejects.toThrow("redirected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("runs every published categorical regression through real domain validators", async () => {
    const files = globSync("tests/fixtures/regressions/*.json");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) verify(JSON.parse(await readFile(file, "utf8")));
    for (const correction of [
      { kind: "unsupported_letter_claim", reviewed: true, variant: "invented_quantity" },
      { kind: "ambiguous_mail", reviewed: true, variant: "receipt_and_interview" },
    ])
      verify(compileRegressionFixture(correction).fixture);
  });
  it("exports a verified fact correction idempotently without copying private evidence", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-regression-")));
    try {
      await mkdir(join(root, "tests", "fixtures"), { recursive: true });
      const fact = documentFacts.find((item) => item.id === "fact-employment-full");
      if (fact?.value.kind !== "employment") throw new Error("Missing fixture fact.");
      const correction = regressionFromFactCorrection(fact, {
        ...fact,
        revision: fact.revision + 1,
        value: { ...fact.value, workload: "part_time" },
      });
      const input = join(root, "private-correction.json");
      await writeFile(input, JSON.stringify(correction));
      await expect(importRegressionFixture(root, input, false)).rejects.toThrow("Reviewed");
      const exported = await importRegressionFixture(root, input, true);
      expect(await importRegressionFixture(root, input, true)).toEqual(exported);
      const path = join(root, "tests", "fixtures", "regressions", exported.filename);
      const bytes = await readFile(path, "utf8");
      expect(bytes).not.toContain(fact.value.employer);
      expect(bytes).not.toContain(fact.id);
      verify(JSON.parse(bytes));
      await writeFile(input, bytes);
      expect(await importRegressionFixture(root, input, true)).toEqual(exported);
      await writeFile(
        input,
        JSON.stringify({ ...JSON.parse(bytes), candidateName: "Synthetic Private Sentinel" }),
      );
      await expect(importRegressionFixture(root, input, true)).rejects.toThrow();
      await writeFile(input, JSON.stringify({ ...JSON.parse(bytes), schemaVersion: 2 }));
      await expect(importRegressionFixture(root, input, true)).rejects.toThrow();
      await writeFile(input, bytes);
      await writeFile(path, "tampered");
      await expect(importRegressionFixture(root, input, true)).rejects.toThrow("do not match");
      await writeFile(input, "x".repeat(16385));
      await expect(importRegressionFixture(root, input, true)).rejects.toThrow("bound");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
