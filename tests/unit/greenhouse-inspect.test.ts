import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  greenhouseUrl,
  inspectGreenhouseForm,
} from "../../packages/browser/src/greenhouse-inspect.js";
import { planGreenhouseFields } from "../../packages/browser/src/greenhouse-plan.js";
import {
  greenhousePreparationResult,
  installGreenhouseReadOnlyRoutes,
} from "../../packages/browser/src/greenhouse-prepare.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

describe("Greenhouse hosted form inspection", () => {
  let browser: Browser;
  let page: Page;
  let packet: PacketSnapshot;
  let cvPdf: Buffer;
  let artifactDir: string;
  const target = { board: "synthetic-board", postingId: "123456" };
  const url = greenhouseUrl(target);
  const html = `<form><label for="first_name">First Name*</label><input id="first_name">
    <label for="last_name">Last Name*</label><input id="last_name">
    <label for="email">Email*</label><input id="email" type="email">
    <label for="resume">Resume/CV*</label><input id="resume" type="file">
    <label for="question_123">Visa and relocation support?*</label><textarea id="question_123"></textarea>
    <label for="31933">What is your gender identity?</label><input id="31933">
    <button type="submit">Submit application</button></form>`;

  beforeAll(async () => {
    artifactDir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-greenhouse-")));
    const store = new ArtifactStore(artifactDir);
    await store.initialize();
    const input = documentGenerationInput();
    input.job.url = url;
    const built = await buildPacket(store, input);
    packet = { manifest: built.manifest, content: built.content, valid: true, invalidReason: null };
    const cv = built.manifest.artifacts.find((item) => item.kind === "cv_pdf");
    if (!cv) throw new Error("Synthetic CV PDF missing.");
    cvPdf = await store.read(cv.storageKey, cv.sha256);
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.route(url, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: html }),
    );
    await page.goto(url);
  });

  afterAll(async () => {
    await browser?.close();
    if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
  });

  it("binds the exact target and detects visible required fields", async () => {
    const snapshot = await inspectGreenhouseForm(page, target);
    expect(snapshot.blocker).toBe("none");
    expect(snapshot.fields.find((field) => field.name === "question_123")?.required).toBe(true);
    expect(snapshot.fields.find((field) => field.name === "31933")?.required).toBe(false);
    expect(snapshot.fields.find((field) => field.name === "resume")?.semanticKey).toBe("cv");
    await expect(inspectGreenhouseForm(page, { ...target, postingId: "123457" })).rejects.toThrow(
      "does not match",
    );
  });

  it("plans reviewed identity and leaves mandatory employer questions unresolved", async () => {
    const snapshot = await inspectGreenhouseForm(page, target);
    const planned = planGreenhouseFields(snapshot, packet, {});
    expect(planned.entries.map((entry) => entry.semanticKey)).toEqual([
      "first_name",
      "last_name",
      "email",
      "cv",
    ]);
    expect(planned.unresolved).toEqual(["question_123"]);
    const approved = planGreenhouseFields(snapshot, packet, {
      question_123: "Synthetic reviewed answer.",
    });
    expect(approved.unresolved).toEqual([]);
    expect(approved.entries.find((entry) => entry.name === "31933")).toBeUndefined();
    expect(() =>
      planGreenhouseFields(snapshot, packet, { first_name: "Wrong", last_name: "Name" }),
    ).toThrow("must match");
    expect(() => planGreenhouseFields(snapshot, packet, { email: "other@example.org" })).toThrow(
      "packet-backed field: email",
    );
    expect(() => planGreenhouseFields(snapshot, packet, { cv: "other.pdf" })).toThrow(
      "packet-backed field: cv",
    );
  });

  it("keeps read-only preparation blocked until questions are resolved", async () => {
    const snapshot = await inspectGreenhouseForm(page, target);
    expect(greenhousePreparationResult(target, packet, cvPdf, {}, snapshot, 0).status).toBe(
      "needs_input",
    );
    const approved = { question_123: "Synthetic reviewed answer." };
    expect(greenhousePreparationResult(target, packet, cvPdf, approved, snapshot, 0)).toMatchObject(
      {
        status: "unsupported",
        blockedFinalActions: 0,
        serverApplicationCount: 0,
      },
    );
    expect(greenhousePreparationResult(target, packet, cvPdf, approved, snapshot, 1).status).toBe(
      "unsupported",
    );
    expect(() =>
      greenhousePreparationResult(target, packet, Buffer.from("wrong"), approved, snapshot, 0),
    ).toThrow("do not match");
  });

  it("intercepts a synthetic write before it reaches the form server", async () => {
    const context = await browser.newContext();
    try {
      let blocked = 0;
      await installGreenhouseReadOnlyRoutes(context, () => {
        blocked++;
      });
      const isolated = await context.newPage();
      await isolated.route(url, (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: html }),
      );
      await isolated.goto(url);
      const status = await isolated.evaluate(
        async () => (await fetch("/synthetic-application", { method: "POST" })).status,
      );
      expect(status).toBe(409);
      expect(blocked).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("blocks an invisible mandatory conditional field and fingerprints its presence", async () => {
    const before = await inspectGreenhouseForm(page, target);
    await page.evaluate(() => {
      const label = document.createElement("label");
      label.htmlFor = "question_456";
      label.textContent = "Conditional work authorization*";
      const input = document.createElement("input");
      input.id = "question_456";
      input.style.display = "none";
      document.querySelector("form")?.append(label, input);
    });
    const after = await inspectGreenhouseForm(page, target);
    expect(after.blocker).toBe("unsupported");
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.fields.some((field) => field.name === "question_456")).toBe(false);
    expect(
      greenhousePreparationResult(
        target,
        packet,
        cvPdf,
        { question_123: "Synthetic reviewed answer." },
        after,
        0,
      ).status,
    ).toBe("unsupported");
  });

  it("records visible unlabeled controls as unsupported instead of crashing", async () => {
    await page.locator("form").evaluate((form) => {
      const input = document.createElement("input");
      form.append(input);
    });
    const snapshot = await inspectGreenhouseForm(page, target);
    expect(snapshot.blocker).toBe("unsupported");
    expect(snapshot.fields).toContainEqual(
      expect.objectContaining({
        name: expect.stringMatching(/^unnamed_\d+$/),
        label: expect.stringMatching(/^Unlabeled control \d+$/),
        kind: "unsupported",
      }),
    );
    await page
      .locator("form input:not([id])")
      .last()
      .evaluate((input) => input.remove());
  });

  it("reports challenge scripts before preparation", async () => {
    await page.evaluate(() => {
      const challenge = document.createElement("script");
      challenge.src = "https://www.recaptcha.net/recaptcha/enterprise.js";
      document.body.append(challenge);
    });
    const snapshot = await inspectGreenhouseForm(page, target);
    expect(snapshot.blocker).toBe("challenge");
    expect(
      greenhousePreparationResult(
        target,
        packet,
        cvPdf,
        { question_123: "Synthetic reviewed answer." },
        snapshot,
        0,
      ).status,
    ).toBe("challenge");
  });
});
