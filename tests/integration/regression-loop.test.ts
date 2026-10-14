import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { fillStep, inspectForm, planFields } from "../../packages/browser/src/adapter.js";
import { launchDryRunBrowser } from "../../packages/browser/src/runtime.js";
import { chronology } from "../../packages/candidate/src/domain.js";
import { letterClaimReasonSchema } from "../../packages/contracts/src/index.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { compileLetterProposal } from "../../packages/documents/src/letter-draft.js";
import { classifyMail } from "../../packages/email/src/correlation.js";
import { startMockAts } from "../../packages/mock-ats/src/server.js";
import {
  compileRegressionFixture,
  parseRegressionFixture,
  regressionFromFactCorrection,
} from "../../packages/security/src/regression-fixture.js";
import { importRegressionFixture } from "../../scripts/regression-import.js";
import { documentFacts, documentGenerationInput } from "../fixtures/document-packets.js";
import { letterClaimCase } from "../helpers/letter-claim-cases.js";

async function verify(raw: unknown) {
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
    const { input, content, proposal } = letterClaimCase(fixture.variant);
    expect(() => compileLetterProposal(input, content, proposal)).toThrow(
      expect.objectContaining({ code: "CLAIM_UNSUPPORTED", reason: fixture.variant }),
    );
  } else if (fixture.kind === "ambiguous_mail") {
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
  } else {
    const directory = await mkdtemp(join(tmpdir(), "opencareers-form-regression-"));
    const mock = await startMockAts();
    let owned: Awaited<ReturnType<typeof launchDryRunBrowser>> | undefined;
    try {
      owned = await launchDryRunBrowser(mock.url);
      const store = new ArtifactStore(directory);
      await store.initialize();
      const input = documentGenerationInput();
      const job = { ...input.job, id: "synthetic-engineer-1" };
      const built = await buildPacket(store, {
        ...input,
        job,
        assessment: { ...input.assessment, jobId: job.id },
      });
      const packet = {
        manifest: built.manifest,
        content: built.content,
        valid: true,
        invalidReason: null,
      };
      const cv = built.manifest.artifacts.find((item) => item.kind === "cv_pdf");
      if (!cv) throw new Error("Missing synthetic PDF.");
      const bytes = await store.read(cv.storageKey, cv.sha256);
      await owned.page.goto(`${mock.url}/jobs/standard`);
      if (fixture.kind === "unsupported_form") {
        await owned.page.evaluate(() => {
          const fieldset = document.querySelector("fieldset:not([hidden])");
          if (!fieldset) throw new Error("Missing synthetic step.");
          const label = document.createElement("label");
          label.textContent = "Synthetic required control";
          const input = document.createElement("input");
          input.name = "synthetic_unknown_control";
          input.type = "color";
          input.required = true;
          label.append(input);
          fieldset.append(label);
        });
        const snapshot = await inspectForm(owned.page);
        const plan = planFields(snapshot, packet, { country: "NL" });
        expect(plan.unresolved).toContain("synthetic_unknown_control");
        expect(plan.entries.some((item) => item.name === "synthetic_unknown_control")).toBe(false);
        const result = await fillStep(owned.page, plan, bytes);
        expect(result.status).toBe("needs_input");
      } else {
        await owned.page.getByRole("button", { name: "Next" }).click();
        const plan = planFields(await inspectForm(owned.page), packet, {
          sponsorship_required: "yes",
        });
        await owned.page.goto(`${mock.url}/jobs/changed-question`);
        await owned.page.getByRole("button", { name: "Next" }).click();
        expect((await inspectForm(owned.page)).fingerprint).not.toBe(plan.fingerprint);
        await expect(fillStep(owned.page, plan, bytes)).rejects.toThrow("Form questions changed");
      }
      expect((await mock.app.inject({ url: "/__test/records" })).json().records).toHaveLength(0);
      expect(owned.blockedCommitCount).toBe(0);
    } finally {
      await owned?.close();
      await mock.app.close();
      await rm(directory, { recursive: true, force: true });
    }
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
      await verify(
        JSON.parse(await readFile(join(fixtures, "regressions", result.filename), "utf8")),
      );
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
  const files = globSync("tests/fixtures/regressions/*.json");
  it("keeps a published categorical fixture discoverable", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files)("executes discovered fixture %s through its real validator", async (file) => {
    await verify(JSON.parse(await readFile(file, "utf8")));
  });
  it.each([
    ...letterClaimReasonSchema.options.map((variant) => ({
      kind: "unsupported_letter_claim",
      reviewed: true,
      variant,
    })),
    { kind: "ambiguous_mail", reviewed: true, variant: "receipt_and_interview" },
  ])("executes categorical $kind/$variant", async (correction) => {
    await verify(compileRegressionFixture(correction).fixture);
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
      await verify(JSON.parse(bytes));
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
