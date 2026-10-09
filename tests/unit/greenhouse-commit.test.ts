import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdapterRegistry } from "../../packages/browser/src/adapter-sdk.js";
import {
  commitGreenhousePacket,
  GreenhouseDefinitiveRejection,
} from "../../packages/browser/src/greenhouse-commit.js";
import {
  greenhouseUrl,
  inspectGreenhouseForm,
} from "../../packages/browser/src/greenhouse-inspect.js";
import { planGreenhouseFields } from "../../packages/browser/src/greenhouse-plan.js";
import {
  fillGreenhouseForm,
  greenhousePreparationResult,
} from "../../packages/browser/src/greenhouse-prepare.js";
import type { BrowserPreparation } from "../../packages/contracts/src/browser.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

const baseTarget = { board: "synthetic-board", postingId: "123456" };
const url = greenhouseUrl(baseTarget);
const form = `<form method="post" action="${url}" enctype="multipart/form-data">
  <label for="first_name">First Name*</label><input id="first_name" name="first_name" required>
  <label for="last_name">Last Name*</label><input id="last_name" name="last_name" required>
  <label for="email">Email*</label><input id="email" name="email" type="email" required>
  <label for="resume">Resume/CV*</label><input id="resume" name="resume" type="file" required>
  <label for="question_123">Reviewed answer*</label><textarea id="question_123" name="question_123" required></textarea>
  <button type="submit">Submit application</button></form>`;

let root: string;
let packet: PacketSnapshot;
let cvPdf: Buffer;
let prepared: BrowserPreparation;
let target: typeof baseTarget & { formFingerprint: string };

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-greenhouse-commit-")));
  const store = new ArtifactStore(root);
  await store.initialize();
  const input = documentGenerationInput();
  input.job.url = url;
  const built = await buildPacket(store, input);
  packet = { manifest: built.manifest, content: built.content, valid: true, invalidReason: null };
  const cv = built.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!cv) throw new Error("Synthetic CV PDF missing.");
  cvPdf = await store.read(cv.storageKey, cv.sha256);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: form }));
    await page.goto(url);
    const snapshot = await inspectGreenhouseForm(page, baseTarget);
    target = { ...baseTarget, formFingerprint: snapshot.fingerprint };
    const plan = planGreenhouseFields(snapshot, packet, {
      question_123: "Synthetic reviewed answer.",
    });
    const report = await fillGreenhouseForm(page, target, snapshot, plan, packet, cvPdf);
    const result = greenhousePreparationResult(
      target,
      packet,
      cvPdf,
      { question_123: "Synthetic reviewed answer." },
      snapshot,
      0,
      report,
    );
    prepared = {
      id: "00000000-0000-4000-8000-000000000123",
      status: result.status,
      result,
      createdAt: "2026-09-28T00:00:00.000Z",
      expiresAt: null,
      resolvedAt: null,
    };
    expect(prepared.status).toBe("ready");
  } finally {
    await browser.close();
  }
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function fixture(status = 200, changed = false) {
  let posts = 0;
  const receiptId = randomUUID();
  const hash = createHash("sha256").update(packet.content.cv.identity.email).digest("hex");
  const configureContext = async (context: BrowserContext) => {
    await context.route(`${url}*`, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        posts++;
        if (status !== 200) return route.fulfill({ status, body: "Synthetic response" });
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<script>history.replaceState(null, "", "?receipt=${receiptId}")</script><p data-greenhouse-receipt-id="${receiptId}" data-posting-id="${target.postingId}" data-email-hash="${hash}">Application received</p>`,
        });
      }
      return route.fulfill({
        contentType: "text/html",
        body: changed
          ? form.replace(
              "</form>",
              '<label for="new_required">New*</label><input id="new_required" required></form>',
            )
          : form,
      });
    });
  };
  return { configureContext, receiptId, posts: () => posts };
}

describe("Greenhouse synthetic commit", () => {
  it("preserves rejected approval in preparation and never requests a final permit", async () => {
    const portal = fixture();
    const adapter = createAdapterRegistry(root, {
      greenhouseCommit: { configureContext: portal.configureContext },
    }).get("greenhouse");
    const result = await adapter.prepare({
      target,
      packet,
      cvPdf,
      approvedValues: { question_123: "Synthetic reviewed answer." },
      validateAnswers: async (_snapshot, plan) => ({
        ...plan,
        entries: plan.entries.filter((entry) => entry.semanticKey !== "question_123"),
        unresolved: ["question_123"],
      }),
    });
    expect(result.status).toBe("needs_input");
    expect(result.plans[0]?.unresolved).toEqual(["question_123"]);
    expect(result.plans[0]?.entries.some((entry) => entry.semanticKey === "question_123")).toBe(
      false,
    );
    let permits = 0;
    await expect(
      commitGreenhousePacket(
        target,
        packet,
        cvPdf,
        prepared,
        async () => {
          permits++;
          return { expiresAt: "2099-01-01T00:00:00.000Z" };
        },
        { configureContext: portal.configureContext },
      ),
    ).rejects.toMatchObject({ reason: "OTHER_FORM_CHANGED" });
    expect({ permits, posts: portal.posts() }).toEqual({ permits: 0, posts: 0 });
  });

  it("performs one permitted final action and returns correlated receipt evidence", async () => {
    const portal = fixture();
    const adapter = createAdapterRegistry(root, {
      greenhouseCommit: { configureContext: portal.configureContext },
    }).get("greenhouse");
    const result = await adapter.prepare({
      target,
      packet,
      cvPdf,
      approvedValues: { question_123: "Synthetic reviewed answer." },
      validateAnswers: async (_snapshot, plan) => plan,
    });
    const adapterPreparation: BrowserPreparation = {
      ...prepared,
      status: result.status,
      result,
    };
    expect(result.status).toBe("ready");
    let permits = 0;
    await expect(
      adapter.commit({
        validateAnswers: async (_snapshot, plan) => plan,
        target: { ...target, postingId: "654321" },
        packet,
        cvPdf,
        preparation: adapterPreparation,
        authorizeDispatch: async () => {
          permits++;
          return { expiresAt: "2099-01-01T00:00:00.000Z" };
        },
      }),
    ).rejects.toThrow("changed after preparation");
    expect({ permits, posts: portal.posts() }).toEqual({ permits: 0, posts: 0 });
    const outcome = await adapter.commit({
      validateAnswers: async (_snapshot, plan) => plan,
      target,
      packet,
      cvPdf,
      preparation: adapterPreparation,
      authorizeDispatch: async () => {
        permits++;
        return { expiresAt: "2099-01-01T00:00:00.000Z" };
      },
    });
    if (outcome.status !== "confirmed") throw new Error("Expected Greenhouse confirmation.");
    const evidence = outcome.evidence;
    if (evidence.kind !== "greenhouse") throw new Error("Expected Greenhouse receipt evidence.");
    expect(evidence).toMatchObject({
      kind: "greenhouse",
      receiptId: portal.receiptId,
      board: target.board,
      postingId: target.postingId,
      jobId: packet.manifest.jobId,
    });
    expect(new URL(evidence.receiptUrl).searchParams.get("receipt")).toBe(portal.receiptId);
    expect({ permits, posts: portal.posts() }).toEqual({ permits: 1, posts: 1 });
  });

  it("stops changed fields before permit acquisition or a write", async () => {
    const portal = fixture(200, true);
    let permits = 0;
    await expect(
      commitGreenhousePacket(
        target,
        packet,
        cvPdf,
        prepared,
        async () => {
          permits++;
          return { expiresAt: "2099-01-01T00:00:00.000Z" };
        },
        { configureContext: portal.configureContext },
      ),
    ).rejects.toMatchObject({ reason: "GREENHOUSE_FORM_CHANGED" });
    expect({ permits, posts: portal.posts() }).toEqual({ permits: 0, posts: 0 });
  });

  it("distinguishes definitive validation rejection from an unknown response", async () => {
    const rejected = fixture(422);
    await expect(
      commitGreenhousePacket(
        target,
        packet,
        cvPdf,
        prepared,
        async () => ({ expiresAt: "2099-01-01T00:00:00.000Z" }),
        {
          configureContext: rejected.configureContext,
          validateAnswers: async (_snapshot, plan) => plan,
        },
      ),
    ).rejects.toBeInstanceOf(GreenhouseDefinitiveRejection);
    expect(rejected.posts()).toBe(1);

    const unknown = fixture(503);
    await expect(
      commitGreenhousePacket(
        target,
        packet,
        cvPdf,
        prepared,
        async () => ({ expiresAt: "2099-01-01T00:00:00.000Z" }),
        {
          configureContext: unknown.configureContext,
          validateAnswers: async (_snapshot, plan) => plan,
        },
      ),
    ).rejects.toThrow("outcome is unknown");
    expect(unknown.posts()).toBe(1);
  });
});
