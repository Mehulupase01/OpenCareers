import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../packages/contracts/src/index.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import {
  buildLetterRequest,
  compileLetterProposal,
} from "../../packages/documents/src/letter-draft.js";
import { LetterDraftRunner } from "../../packages/documents/src/letter-gateway.js";
import { validatePacketContent } from "../../packages/documents/src/validation.js";
import { assertExternalLetter } from "../../packages/persistence/src/submission-repository.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

describe("LLM letter proposal boundary", () => {
  const input = documentGenerationInput();
  const content = generatePacketContent(input);
  const proposal = {
    opening: content.letter.opening,
    motivation: "The role's focus on Python makes this platform work especially compelling.",
    contributionIds: [content.letter.contributions[0]?.id ?? "missing"],
  };

  it("sends only bounded vacancy and approved contribution text on a pinned free route", () => {
    const request = buildLetterRequest(input, content, "synthetic/model:free", "synthetic");
    expect(request.provider).toEqual({
      only: ["synthetic"],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
    });
    const payload = JSON.parse(request.messages[1]?.content ?? "{}") as Record<string, unknown>;
    expect(payload).toHaveProperty("company", input.job.company);
    expect(payload).toHaveProperty("vacancyDescription", input.job.description);
    expect(JSON.stringify(payload)).not.toContain(input.profile.facts[0]?.value.kind);
    expect(JSON.stringify(payload)).not.toContain("Authorized to work");
    expect(request).not.toHaveProperty("tools");
    expect(() => buildLetterRequest(input, content, "synthetic/paid", "synthetic")).toThrow(
      "pinned free route",
    );
    expect(() =>
      buildLetterRequest(
        { ...input, job: { ...input.job, company: "Another Employer" } },
        content,
        "synthetic/model:free",
        "synthetic",
      ),
    ).toThrow("changed after packet generation");
  });

  it("compiles model-selected evidence into a letter accepted by the packet validator", () => {
    const letter = compileLetterProposal(input, content, proposal);
    expect(letter.motivation).toBe(proposal.motivation);
    expect(letter.contributions[0]?.origin).toBe("inference_validated");
    const report = validatePacketContent({
      content: { ...content, letter },
      profile: input.profile,
      assessment: input.assessment,
      asOf: input.asOf,
      checkedAt: input.generatedAt,
    });
    expect(report.status).not.toBe("blocked");
  });

  it("stores the LLM draft and its route evidence in an immutable packet manifest", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-llm-letter-")));
    try {
      const store = new ArtifactStore(root);
      await store.initialize();
      const letter = compileLetterProposal(input, content, proposal);
      const built = await buildPacket(store, input, {
        letter,
        modelId: "synthetic/model:free",
        provider: "synthetic",
        responseHash: "a".repeat(64),
      });
      expect(built.content.letter).toEqual(letter);
      expect(built.manifest.letterGeneration).toEqual({
        method: "llm",
        modelId: "synthetic/model:free",
        provider: "synthetic",
        responseHash: "a".repeat(64),
      });
      expect(built.manifest.validation.status).not.toBe("blocked");
      expect(() => assertExternalLetter(built.manifest, "recruitee", true)).not.toThrow();
      const deterministic = await buildPacket(store, input);
      expect(() => assertExternalLetter(deterministic.manifest, "recruitee", true)).toThrow(
        "validated LLM letter",
      );
      expect(() => assertExternalLetter(deterministic.manifest, "mock-ats", true)).not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invented evidence and unsupported prose", () => {
    expect(() =>
      compileLetterProposal(input, content, { ...proposal, contributionIds: ["invented"] }),
    ).toThrow("unapproved evidence");
    expect(() =>
      compileLetterProposal(input, content, {
        ...proposal,
        motivation: "I built 100 production systems using Python.",
      }),
    ).toThrow("unsupported claims");
    expect(() =>
      compileLetterProposal(input, content, {
        ...proposal,
        motivation: "The role's focus on Python builds on work at Synthetic Systems Nederland B.V.",
      }),
    ).toThrow("another employer");
    expect(() =>
      compileLetterProposal(input, content, {
        ...proposal,
        opening: "I am applying at the wrong employer.",
      }),
    ).toThrow("bound vacancy");
    expect(() =>
      compileLetterProposal(input, content, {
        ...proposal,
        motivation: "The role's focus on Python suits my experience.",
      }),
    ).toThrow("unsupported claims");
    expect(() =>
      compileLetterProposal(input, content, {
        ...proposal,
        motivation: "The role's focus on Python <script> is interesting.",
      }),
    ).toThrow("unsupported claims");
    expect(() =>
      compileLetterProposal(input, content, {
        ...proposal,
        contributionIds: [proposal.contributionIds[0], proposal.contributionIds[0]],
      }),
    ).toThrow("repeats a contribution");
  });

  it.each([
    ["The role's focus on Python makes this opportunity compelling.", true],
    ["I am drawn to the role's focus on PostgreSQL and platform services.", true],
    ["The role's focus on Python is particularly interesting to me.", true],
    ["The role's focus on Python matches my 10 years of experience.", false],
    ["As an experienced engineer, I can bring Python expertise.", false],
    ["The role's focus on Python helped me win awards.", false],
    ["The role's focus on Python builds on the award-winning platform I shipped.", false],
    ["The role's focus on Python means I deployed 100 services.", false],
    ["The role's focus on Python is explained at https://example.com.", false],
    ["The role's focus on Rust makes this opportunity compelling.", false],
  ])("evaluates synthetic motivation: %s", (motivation, accepted) => {
    const compile = () => compileLetterProposal(input, content, { ...proposal, motivation });
    if (accepted) expect(compile).not.toThrow();
    else expect(compile).toThrow();
  });

  it("charges one durable reservation and returns validated route evidence", async () => {
    const ledger = {
      snapshot: vi.fn(async () => ({
        route: { status: "ready", modelId: "synthetic/model:free", provider: "synthetic" },
      })),
      reserve: vi.fn(async () => ({ id: "reservation-1" })),
      markSent: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const runner = new LetterDraftRunner(
      ledger as unknown as ConstructorParameters<typeof LetterDraftRunner>[0],
      10,
      {
        complete: async () => ({
          model: "synthetic/model:free",
          provider: "synthetic",
          content: JSON.stringify(proposal),
          usage: { promptTokens: 80, completionTokens: 40 },
        }),
      },
    );
    const draft = await runner.draft(input, content);
    expect(draft.letter.motivation).toBe(proposal.motivation);
    expect(ledger.reserve).toHaveBeenCalledWith(
      "synthetic/model:free",
      "synthetic",
      10,
      input.assessment.applicationId,
    );
    expect(ledger.markSent).toHaveBeenCalledOnce();
    expect(ledger.finish).toHaveBeenCalledWith("reservation-1", {
      status: "completed",
      responseHash: draft.responseHash,
    });
    expect(ledger.release).not.toHaveBeenCalled();
  });

  it("fails closed without a route and records a sent invalid proposal as failed", async () => {
    const ledger = {
      snapshot: vi.fn(async () => ({
        route: {
          status: "paused",
          modelId: null as string | null,
          provider: null as string | null,
        },
      })),
      reserve: vi.fn(async () => ({ id: "reservation-2" })),
      markSent: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const runner = new LetterDraftRunner(
      ledger as unknown as ConstructorParameters<typeof LetterDraftRunner>[0],
      10,
      {
        complete: async () => ({
          model: "synthetic/model:free",
          provider: "synthetic",
          content: "not JSON",
          usage: { promptTokens: 1, completionTokens: 1 },
        }),
      },
    );
    await expect(runner.draft(input, content)).rejects.toThrow("No reviewed free letter route");
    expect(ledger.reserve).not.toHaveBeenCalled();
    ledger.snapshot.mockResolvedValueOnce({
      route: { status: "ready", modelId: "synthetic/model:free", provider: "synthetic" },
    });
    await expect(runner.draft(input, content)).rejects.toThrow("not valid JSON");
    expect(ledger.finish).toHaveBeenCalledWith("reservation-2", {
      status: "failed",
      errorCode: "CLAIM_UNSUPPORTED",
    });
  });

  it("records a rate-limited sent call without releasing its daily quota", async () => {
    const ledger = {
      snapshot: vi.fn(async () => ({
        route: { status: "ready", modelId: "synthetic/model:free", provider: "synthetic" },
      })),
      reserve: vi.fn(async () => ({ id: "reservation-3" })),
      markSent: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const runner = new LetterDraftRunner(
      ledger as unknown as ConstructorParameters<typeof LetterDraftRunner>[0],
      10,
      {
        complete: async () => {
          throw new DomainError("RATE_LIMITED", "Free route is limited.", true);
        },
      },
    );
    await expect(runner.draft(input, content)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(ledger.markSent).toHaveBeenCalledOnce();
    expect(ledger.finish).toHaveBeenCalledWith(
      "reservation-3",
      expect.objectContaining({
        status: "failed",
        errorCode: "RATE_LIMITED",
        backoffUntil: expect.any(String),
      }),
    );
    expect(ledger.release).not.toHaveBeenCalled();
  });
});
