import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitRecruiteePacket,
  prepareRecruiteePacket,
  RecruiteeDefinitiveRejection,
  type RecruiteeRequest,
} from "../../packages/browser/src/recruitee.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

const target = { tenant: "synthetic", offerSlug: "software-engineer" };
const offerUrl = "https://synthetic.recruitee.com/api/offers/software-engineer";
const submitUrl = `${offerUrl}/candidates?async=true`;

let artifactDir: string;
let packet: PacketSnapshot;
let cvPdf: Buffer;

function offer(question = false, updatedAt = "2026-09-27 00:00:00 UTC") {
  return {
    offer: {
      id: 42,
      slug: target.offerSlug,
      careers_url: "https://synthetic.recruitee.com/o/software-engineer",
      status: "published",
      updated_at: updatedAt,
      options_cv: "required",
      options_phone: "required",
      options_cover_letter: "optional",
      locations_question_required: true,
      locations: [{ id: 7 }],
      open_questions: question
        ? [
            {
              id: 91,
              kind: "string",
              required: true,
              body: "Why this role?",
              open_question_options: [],
            },
          ]
        : [],
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(async () => {
  artifactDir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-recruitee-")));
  const store = new ArtifactStore(artifactDir);
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
  if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
});

describe("Recruitee candidate adapter", () => {
  it("prepares supported fields without dispatching an application", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const request: RecruiteeRequest = async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return json(offer());
    };
    const prepared = await prepareRecruiteePacket(target, packet, cvPdf, {}, request);
    expect(prepared.status).toBe("ready");
    expect(prepared.snapshots[0]?.origin).toBe("https://synthetic.recruitee.com");
    expect(prepared.plans[0]?.entries.map((item) => item.name)).toEqual([
      "name",
      "email",
      "phone",
      "cv",
      "cover_letter",
    ]);
    expect(requests).toEqual([{ url: offerUrl, method: "GET" }]);
  });

  it("fails closed when a required screening answer is not reviewed", async () => {
    const requiredQuestion = offer(true);
    const request: RecruiteeRequest = async () => json(requiredQuestion);
    const prepared = await prepareRecruiteePacket(target, packet, cvPdf, {}, request);
    expect(prepared.status).toBe("unsupported");
    expect(prepared.issues).toContain("Required answer unresolved: recruitee_question_91");

    const firstQuestion = requiredQuestion.offer.open_questions[0];
    if (!firstQuestion) throw new Error("Expected a screening question.");
    firstQuestion.kind = "boolean";
    const answeredNo = await prepareRecruiteePacket(
      target,
      packet,
      cvPdf,
      { recruitee_question_91: false },
      request,
    );
    expect(answeredNo.status).toBe("ready");
    expect(answeredNo.plans[0]?.entries.at(-1)?.expected).toBe("false");
  });

  it("rechecks drift and sends one correlated multipart request after authorization", async () => {
    const events: string[] = [];
    let current = offer();
    const request: RecruiteeRequest = async (input, init) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "GET") return json(current);
      events.push("post");
      expect(url).toBe(submitUrl);
      const form = init?.body as FormData;
      expect(form.get("candidate[name]")).toBe(packet.content.cv.identity.fullName);
      expect(form.get("candidate[email]")).toBe(packet.content.cv.identity.email);
      expect(form.get("candidate[phone]")).toBe(packet.content.cv.identity.phone);
      expect(form.get("candidate[cv]")).toBeInstanceOf(Blob);
      return json({ candidate: { id: 8123, emails: [packet.content.cv.identity.email] } }, 201);
    };
    const prepared = await prepareRecruiteePacket(target, packet, cvPdf, {}, request);
    const evidence = await commitRecruiteePacket(
      target,
      packet,
      cvPdf,
      prepared,
      async () => {
        events.push("authorize");
        return { expiresAt: "2026-09-27T00:01:00.000Z" };
      },
      request,
      () => new Date("2026-09-27T00:00:00.000Z"),
    );
    expect(events).toEqual(["authorize", "post"]);
    expect(evidence).toMatchObject({
      kind: "recruitee",
      candidateId: 8123,
      tenant: target.tenant,
      offerSlug: target.offerSlug,
      jobId: packet.manifest.jobId,
      responseUrl: submitUrl,
    });

    current = offer(false, "2026-09-27 00:02:00 UTC");
    events.length = 0;
    await expect(
      commitRecruiteePacket(
        target,
        packet,
        cvPdf,
        prepared,
        async () => {
          events.push("authorize");
          return { expiresAt: "2026-09-27T00:03:00.000Z" };
        },
        request,
        () => new Date("2026-09-27T00:02:00.000Z"),
      ),
    ).rejects.toThrow("fields changed");
    expect(events).toEqual([]);

    current = offer(true);
    const injected = current.offer.open_questions[0];
    if (!injected) throw new Error("Expected an injected mandatory question.");
    injected.kind = "file";
    const blocked = await prepareRecruiteePacket(target, packet, cvPdf, {}, request);
    expect(blocked.status).toBe("unsupported");
    expect(blocked.issues).toContain("Required field type is unsupported: recruitee_question_91");
    await expect(
      commitRecruiteePacket(
        target,
        packet,
        cvPdf,
        prepared,
        async () => {
          events.push("authorize");
          return { expiresAt: "2026-09-27T00:03:00.000Z" };
        },
        request,
        () => new Date("2026-09-27T00:02:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "FORM_CHANGED" });
    expect(events).toEqual([]);
  });

  it("classifies a returned validation response as definitive", async () => {
    const request: RecruiteeRequest = async (_input, init) =>
      (init?.method ?? "GET") === "GET"
        ? json(offer())
        : json({ error: ["Synthetic validation rejection"] }, 422);
    const prepared = await prepareRecruiteePacket(target, packet, cvPdf, {}, request);
    await expect(
      commitRecruiteePacket(
        target,
        packet,
        cvPdf,
        prepared,
        async () => ({ expiresAt: "2026-09-27T00:01:00.000Z" }),
        request,
        () => new Date("2026-09-27T00:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(RecruiteeDefinitiveRejection);
  });
});
