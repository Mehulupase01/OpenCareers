import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdapterRegistry } from "../../packages/browser/src/adapter-sdk.js";
import type { RecruiteeRequest } from "../../packages/browser/src/recruitee.js";
import type { BrowserPreparation, DryRunResult } from "../../packages/contracts/src/browser.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

let root: string;
let packet: PacketSnapshot;
let cvPdf: Buffer;

const fixedClock = "2026-09-27T00:00:00.000Z";

function preparation(result: DryRunResult): BrowserPreparation {
  return {
    id: "00000000-0000-4000-8000-000000000099",
    status: result.status,
    result,
    createdAt: fixedClock,
    expiresAt: null,
    resolvedAt: null,
  };
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-adapter-sdk-")));
  const store = new ArtifactStore(root);
  await store.initialize();
  const input = documentGenerationInput();
  input.job.url = "https://synthetic.recruitee.com/o/software-engineer";
  const built = await buildPacket(store, input);
  packet = { manifest: built.manifest, content: built.content, valid: true, invalidReason: null };
  const cv = built.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!cv) throw new Error("Synthetic CV PDF missing.");
  cvPdf = await store.read(cv.storageKey, cv.sha256);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("submission adapter SDK", () => {
  it("rejects caller overrides of packet-backed fields before dispatch", async () => {
    const adapter = createAdapterRegistry(root).get("mock-ats");
    for (const key of ["full_name", "email", "phone", "motivation", "portfolio", "cv"]) {
      await expect(
        adapter.prepare({
          packet,
          cvPdf,
          target: { fixture: "standard" },
          approvedValues: { [key]: "unreviewed replacement" },
        }),
      ).rejects.toThrow(`packet-backed field: ${key}`);
    }
  });

  it("runs mock ATS through the common prepare and commit contract", async () => {
    const registry = createAdapterRegistry(root);
    expect(registry.support()).toEqual([
      { id: "mock-ats", version: "mock-ats-v1" },
      { id: "recruitee", version: "recruitee-careers-v1" },
    ]);
    const adapter = registry.get("mock-ats");
    const target = adapter.parseTarget({ fixture: "standard", ignoredTaskField: "stripped" });
    const result = await adapter.prepare({
      packet,
      cvPdf,
      target,
      approvedValues: {
        country: "NL",
        sponsorship_required: "no",
        available_from: "2026-11-01",
        remote_preference: "yes",
        terms: true,
      },
    });
    expect(result.status).toBe("ready");
    let permits = 0;
    const outcome = await adapter.commit({
      packet,
      cvPdf,
      preparation: preparation(result),
      target,
      authorizeDispatch: async () => {
        permits++;
        return { expiresAt: new Date(Date.now() + 10000).toISOString() };
      },
    });
    expect(outcome.status).toBe("confirmed");
    expect(outcome.status === "confirmed" && outcome.evidence.kind).toBe("mock_ats");
    expect(permits).toBe(1);
  });

  it("runs Recruitee through the same contract and rejects target drift", async () => {
    let posts = 0;
    const request: RecruiteeRequest = async (_input, init) => {
      if ((init?.method ?? "GET") === "POST") {
        posts++;
        return new Response(
          JSON.stringify({
            candidate: { id: 8123, emails: [packet.content.cv.identity.email] },
          }),
          { status: 201 },
        );
      }
      return new Response(
        JSON.stringify({
          offer: {
            id: 42,
            slug: "software-engineer",
            careers_url: "https://synthetic.recruitee.com/o/software-engineer",
            status: "published",
            updated_at: fixedClock,
            options_cv: "required",
            options_phone: "required",
            options_cover_letter: "optional",
            locations_question_required: true,
            locations: [{ id: 7 }],
            open_questions: [],
          },
        }),
        { status: 200 },
      );
    };
    const adapter = createAdapterRegistry(root, { recruiteeRequest: request }).get("recruitee");
    const target = adapter.parseTarget({
      tenant: "synthetic",
      offerSlug: "software-engineer",
      packetId: "stripped",
    });
    const result = await adapter.prepare({ packet, cvPdf, target, approvedValues: {} });
    const prepared = preparation(result);
    await expect(
      adapter.commit({
        packet,
        cvPdf,
        preparation: preparation({ ...result, adapter: null }),
        target,
        authorizeDispatch: async () => {
          throw new Error("Legacy preparation must not receive a dispatch permit.");
        },
      }),
    ).rejects.toThrow("predates adapter identity binding");
    expect(posts).toBe(0);
    await expect(
      adapter.commit({
        packet,
        cvPdf,
        preparation: prepared,
        target: { tenant: "synthetic", offerSlug: "different-offer" },
        authorizeDispatch: async () => ({ expiresAt: "2099-01-01T00:00:00.000Z" }),
      }),
    ).rejects.toThrow("changed after preparation");
    expect(posts).toBe(0);

    let permits = 0;
    const outcome = await adapter.commit({
      packet,
      cvPdf,
      preparation: prepared,
      target,
      authorizeDispatch: async () => {
        permits++;
        return { expiresAt: "2099-01-01T00:00:00.000Z" };
      },
    });
    expect(outcome.status).toBe("confirmed");
    expect(outcome.status === "confirmed" && outcome.evidence.kind).toBe("recruitee");
    expect({ permits, posts }).toEqual({ permits: 1, posts: 1 });
  });
});
