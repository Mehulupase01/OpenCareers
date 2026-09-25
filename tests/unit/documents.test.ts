import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { CandidateFact } from "../../packages/contracts/src/candidate.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import {
  equivalenceIssues,
  extractDocx,
  extractPdf,
} from "../../packages/documents/src/extract.js";
import {
  renderCvDocx,
  renderCvPdf,
  renderLetterDocx,
  renderLetterPdf,
} from "../../packages/documents/src/render.js";
import { validatePacketContent } from "../../packages/documents/src/validation.js";
import {
  documentAssessment,
  documentGenerationInput,
  documentProfile,
} from "../fixtures/document-packets.js";

describe("document packet generation", () => {
  it("selects professional evidence before projects and keeps experience totals distinct", () => {
    const input = documentGenerationInput();
    const content = generatePacketContent(input);
    expect(content.letter.contributions[0]?.evidence[0]?.factId).toBe("fact-employment-full");
    expect(content.cv.projects).toHaveLength(1);
    expect(content.changeSummary.selectedEvidence).toContain(
      "Project evidence fact-project fills an uncovered requirement.",
    );
    expect(content.cv.experience.professional.text).toBe(
      "3 years of full-time professional experience.",
    );
    expect(content.cv.experience.handsOn.text).toBe("5 years of hands-on employment experience.");
    expect(content.answers.map((answer) => answer.status)).toEqual(["approved_reuse", "deferred"]);
    expect(
      validatePacketContent({
        content,
        profile: input.profile,
        assessment: input.assessment,
        asOf: input.asOf,
        checkedAt: input.generatedAt,
      }).status,
    ).toBe("needs_input");
  });

  it("links a summary employer to employment evidence when requirements match only a skill", () => {
    const input = documentGenerationInput();
    const assessment = {
      ...input.assessment,
      requirements: input.assessment.requirements.map((requirement) => ({
        ...requirement,
        factIds: requirement.factIds.filter((id) => id !== "fact-employment-full"),
      })),
    };
    const content = generatePacketContent({ ...input, assessment });
    expect(content.cv.summary.text).toContain("Synthetic Systems Nederland B.V.");
    expect(content.cv.summary.evidence.map((evidence) => evidence.factId)).toContain(
      "fact-employment-full",
    );
    const report = validatePacketContent({
      content,
      profile: input.profile,
      assessment,
      asOf: input.asOf,
      checkedAt: input.generatedAt,
    });
    expect(report.status).not.toBe("blocked");
  });

  it("rejects a prototype upgraded to a deployed claim", () => {
    const input = documentGenerationInput();
    const assessment = {
      ...documentAssessment,
      requirements: documentAssessment.requirements.map((requirement) => ({
        ...requirement,
        factIds: ["fact-project"],
      })),
    };
    const content = generatePacketContent({ ...input, assessment });
    const project = content.cv.projects[0];
    expect(project).toBeDefined();
    if (!project) throw new Error("Project fixture was not selected.");
    project.deliveryStatus = "deployed";
    project.text = "Deployed a Python queue inspector.";
    const report = validatePacketContent({
      content,
      profile: documentProfile,
      assessment,
      asOf: input.asOf,
      checkedAt: input.generatedAt,
    });
    expect(report.status).toBe("blocked");
    expect(report.issues.some((issue) => issue.code === "DELIVERY_UPGRADED")).toBe(true);
  });

  it("renders equivalent bounded DOCX and PDF artifacts with accented text", async () => {
    const input = documentGenerationInput();
    const content = generatePacketContent(input);
    const [cvDocxBuffer, cvPdfBuffer, letterDocxBuffer, letterPdfBuffer] = await Promise.all([
      renderCvDocx(content.cv, content.generatedAt),
      renderCvPdf(content.cv, content.generatedAt),
      renderLetterDocx(content.letter, content.cv.identity.fullName, content.generatedAt),
      renderLetterPdf(content.letter, content.cv.identity.fullName, content.generatedAt),
    ]);
    const [cvDocx, cvPdf, letterDocx, letterPdf] = await Promise.all([
      extractDocx(cvDocxBuffer),
      extractPdf(cvPdfBuffer),
      extractDocx(letterDocxBuffer),
      extractPdf(letterPdfBuffer),
    ]);
    expect(cvDocx.text).toContain("Zoë Jansen");
    expect(cvPdf.text).toContain("Zoë Jansen");
    expect(cvPdf.pages).toBeGreaterThanOrEqual(1);
    expect(cvPdf.pages).toBeLessThanOrEqual(2);
    expect(letterPdf.pages).toBe(1);
    expect(equivalenceIssues(content, cvDocx, cvPdf, letterDocx, letterPdf)).toEqual([]);
  });

  it("renders byte-identical DOCX artifacts independently of wall-clock time", async () => {
    const content = generatePacketContent(documentGenerationInput());
    const first = await renderCvDocx(content.cv, content.generatedAt);
    await setTimeout(2100);
    const second = await renderCvDocx(content.cv, content.generatedAt);
    expect(createHash("sha256").update(first).digest("hex")).toBe(
      createHash("sha256").update(second).digest("hex"),
    );
  });

  it("defers an approved answer that exceeds the employer character limit", () => {
    const input = documentGenerationInput();
    const content = generatePacketContent({
      ...input,
      requestedAnswers: [
        {
          semanticKey: "right_to_work",
          meaning: "Right to work?",
          maxCharacters: 2,
          country: "NL",
        },
      ],
    });
    expect(content.answers[0]).toMatchObject({ status: "deferred", answer: null });
  });

  it("uses approved authorization wording for a sponsorship answer without inference", () => {
    const input = documentGenerationInput();
    const content = generatePacketContent({
      ...input,
      approvedAnswers: [],
      requestedAnswers: [
        {
          semanticKey: "sponsorship_required",
          meaning: "Will you require sponsorship?",
          maxCharacters: 200,
          country: "NL",
        },
      ],
    });
    expect(content.answers[0]).toMatchObject({
      status: "deterministic",
      answer: "Authorized to work in the Netherlands without sponsorship.",
    });
  });

  it("blocks ineligible vacancies, lookalike employers and unresolved placeholders", () => {
    const input = documentGenerationInput();
    const assessment = { ...input.assessment, outcome: "ineligible" as const };
    const content = generatePacketContent({ ...input, assessment });
    content.letter.company = "Northstar System";
    content.letter.opening = "I am applying for the [role] at Northstar System.";
    const report = validatePacketContent({
      content,
      profile: input.profile,
      assessment,
      asOf: input.asOf,
      checkedAt: input.generatedAt,
    });
    expect(report.status).toBe("blocked");
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["VACANCY_MISMATCH", "PLACEHOLDER_PRESENT", "CLAIM_UNSUPPORTED"]),
    );
  });

  it("keeps a long representative CV within two readable pages", async () => {
    const input = documentGenerationInput();
    const baseEmployment = input.profile.facts.find((fact) => fact.id === "fact-employment-full");
    if (!baseEmployment) throw new Error("Expected employment fixture.");
    const employment: CandidateFact[] = Array.from({ length: 9 }, (_, index) => ({
      ...baseEmployment,
      id: `fact-long-employment-${index}`,
      key: `employment-long-${index}`,
      value: {
        kind: "employment" as const,
        employer: `Synthetic International Employer With A Long Name ${index}`,
        title: "Software Engineer",
        start: `${2013 + index}-01`,
        end: `${2013 + index}-12`,
        workload: "full_time" as const,
        description:
          "Built reliable data services, maintained release controls, and documented operational evidence.",
      },
    }));
    const profile = { ...input.profile, facts: [...input.profile.facts, ...employment] };
    const content = generatePacketContent({ ...input, profile });
    const extracted = await extractPdf(await renderCvPdf(content.cv, content.generatedAt));
    expect(extracted.pages).toBe(2);
    expect(extracted.issues).toEqual([]);
    expect(extracted.text).toContain("Synthetic International Employer With A Long Name 8");
  });

  it("fails closed when a DOCX converter result is not a valid package", async () => {
    await expect(extractDocx(Buffer.from("not a docx"))).rejects.toThrow();
  });
});
