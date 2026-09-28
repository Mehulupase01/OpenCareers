import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  greenhouseUrl,
  inspectGreenhouseForm,
} from "../../packages/browser/src/greenhouse-inspect.js";
import { planGreenhouseFields } from "../../packages/browser/src/greenhouse-plan.js";
import {
  fillGreenhouseForm,
  greenhousePreparationResult,
  installGreenhouseReadOnlyRoutes,
} from "../../packages/browser/src/greenhouse-prepare.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

describe("Greenhouse synthetic fill", () => {
  const target = { board: "synthetic-board", postingId: "123456" };
  const url = greenhouseUrl(target);
  const html = `<form><label for="first_name">First Name*</label><input id="first_name">
    <label for="last_name">Last Name*</label><input id="last_name">
    <label for="email">Email*</label><input id="email" type="email">
    <label for="resume">Resume/CV*</label><input id="resume" type="file">
    <label for="question_123">Reviewed answer*</label><textarea id="question_123"></textarea>
    <label for="consent">Consent*</label><input id="consent" type="checkbox" required>
    <button type="submit">Submit application</button></form>`;
  let browser: Browser;
  let page: Page;
  let packet: PacketSnapshot;
  let cvPdf: Buffer;
  let artifactDir: string;
  let blocked = 0;

  beforeAll(async () => {
    artifactDir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-greenhouse-fill-")));
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
  });

  beforeEach(async () => {
    blocked = 0;
    const context = await browser.newContext({ serviceWorkers: "block" });
    await installGreenhouseReadOnlyRoutes(context, () => {
      blocked++;
    });
    page = await context.newPage();
    await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(url);
  });

  afterAll(async () => {
    await browser?.close();
    if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
  });

  const approved = { question_123: "Synthetic reviewed answer.", consent: true };

  it("rejects an invalid or wrong-posting packet before filling", async () => {
    const snapshot = await inspectGreenhouseForm(page, target);
    const plan = planGreenhouseFields(snapshot, packet, approved);
    const invalid = { ...packet, valid: false };
    await expect(fillGreenhouseForm(page, target, snapshot, plan, invalid, cvPdf)).rejects.toThrow(
      "not valid",
    );
    const wrongPosting = {
      ...packet,
      content: {
        ...packet.content,
        job: { ...packet.content.job, url: greenhouseUrl({ ...target, postingId: "654321" }) },
      },
    };
    await expect(
      fillGreenhouseForm(page, target, snapshot, plan, wrongPosting, cvPdf),
    ).rejects.toThrow("does not match");
    expect(await page.locator("#first_name").inputValue()).toBe("");
    expect(blocked).toBe(0);
    await page.context().close();
  });

  it("fills the exact plan, selects packet CV bytes, and remains unsupported", async () => {
    const snapshot = await inspectGreenhouseForm(page, target);
    const plan = planGreenhouseFields(snapshot, packet, approved);
    const report = await fillGreenhouseForm(page, target, snapshot, plan, packet, cvPdf);
    expect(report.status).toBe("ready");
    expect(report.uploadStatus).toBe("selected");
    expect(report.readBack.map((field) => field.name)).toEqual(
      plan.entries.map((entry) => entry.name),
    );
    expect(report.readBack.every((field) => field.matches)).toBe(true);
    expect(report.issues).toEqual([]);
    const result = greenhousePreparationResult(
      target,
      packet,
      cvPdf,
      approved,
      snapshot,
      blocked,
      report,
    );
    expect(result).toMatchObject({
      status: "unsupported",
      serverApplicationCount: 0,
      blockedFinalActions: 0,
    });
    expect(result.reports[0]?.uploadStatus).toBe("selected");
    expect(blocked).toBe(0);
    await page.context().close();
  });

  it("refuses unresolved, drifted, challenged, and wrong CV inputs before filling", async () => {
    const snapshot = await inspectGreenhouseForm(page, target);
    const plan = planGreenhouseFields(snapshot, packet, approved);
    await expect(
      fillGreenhouseForm(
        page,
        target,
        snapshot,
        planGreenhouseFields(snapshot, packet, {}),
        packet,
        cvPdf,
      ),
    ).rejects.toThrow("unresolved");
    await expect(
      fillGreenhouseForm(page, target, snapshot, plan, packet, Buffer.from("wrong")),
    ).rejects.toThrow("do not match");
    await page.locator("form").evaluate((form) => {
      const input = document.createElement("input");
      input.id = "extra";
      input.setAttribute("aria-label", "Extra");
      form.append(input);
    });
    await expect(fillGreenhouseForm(page, target, snapshot, plan, packet, cvPdf)).rejects.toThrow(
      "changed after planning",
    );
    await page.locator("form").evaluate((form) => {
      form.querySelector("#extra")?.remove();
      const challenge = document.createElement("div");
      challenge.className = "g-recaptcha";
      form.append(challenge);
    });
    await expect(fillGreenhouseForm(page, target, snapshot, plan, packet, cvPdf)).rejects.toThrow(
      "blocked",
    );
    expect(await page.locator("#first_name").inputValue()).toBe("");
    await page.context().close();
  });

  it("detects a client-side read-back mismatch without a server write", async () => {
    await page.locator("#question_123").evaluate((field) => {
      field.addEventListener("input", () => {
        (field as HTMLTextAreaElement).value = "Changed by page";
      });
    });
    const snapshot = await inspectGreenhouseForm(page, target);
    const report = await fillGreenhouseForm(
      page,
      target,
      snapshot,
      planGreenhouseFields(snapshot, packet, approved),
      packet,
      cvPdf,
    );
    expect(report.readBack.find((field) => field.name === "question_123")).toMatchObject({
      actual: "Changed by page",
      matches: false,
    });
    expect(report.issues).toContain("Greenhouse read-back mismatch: question_123");
    expect(report.status).not.toBe("ready");
    expect(blocked).toBe(0);
    await page.context().close();
  });

  it("reports a cleared CV selection as upload failure", async () => {
    await page.locator("#resume").evaluate((field) => {
      field.addEventListener("change", () => {
        (field as HTMLInputElement).value = "";
      });
    });
    const snapshot = await inspectGreenhouseForm(page, target);
    const report = await fillGreenhouseForm(
      page,
      target,
      snapshot,
      planGreenhouseFields(snapshot, packet, approved),
      packet,
      cvPdf,
    );
    expect(report.uploadStatus).toBe("failed");
    expect(report.status).toBe("upload_failed");
    expect(report.readBack.find((field) => field.name === "resume")?.matches).toBe(false);
    expect(
      greenhousePreparationResult(target, packet, cvPdf, approved, snapshot, blocked, report)
        .status,
    ).toBe("upload_failed");
    expect(blocked).toBe(0);
    await page.context().close();
  });

  it("blocks a page-triggered POST during filling", async () => {
    await page.locator("#question_123").evaluate((field) => {
      field.addEventListener("input", () => {
        void fetch("/synthetic-application", { method: "POST" });
      });
    });
    const snapshot = await inspectGreenhouseForm(page, target);
    const report = await fillGreenhouseForm(
      page,
      target,
      snapshot,
      planGreenhouseFields(snapshot, packet, approved),
      packet,
      cvPdf,
    );
    await expect.poll(() => blocked).toBe(1);
    const result = greenhousePreparationResult(
      target,
      packet,
      cvPdf,
      approved,
      snapshot,
      blocked,
      report,
    );
    expect(result.blockedFinalActions).toBe(1);
    expect(result.serverApplicationCount).toBe(0);
    expect(result.status).not.toBe("ready");
    await page.context().close();
  });
});
