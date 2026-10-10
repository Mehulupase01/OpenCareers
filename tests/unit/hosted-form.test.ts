import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { planFields } from "../../packages/browser/src/adapter.js";
import { packetEvidenceGuard } from "../../packages/browser/src/answer-guard.js";
import { fillHostedForm, inspectHostedForm } from "../../packages/browser/src/hosted-form.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

describe("Shared low-risk hosted-form preparation", () => {
  const url = "https://synthetic-careers.test/jobs/123";
  const html = `<form method="post" action="/applications"><label for="name">Full name</label><input id="name" required>
    <span id="email-label">Email address</span><input id="contact" type="email" aria-labelledby="email-label" required>
    <input id="phone" type="tel" aria-label="Phone number"><button type="submit">Apply</button></form>`;
  let browser: Browser;
  let page: Page;
  let packet: PacketSnapshot;
  let dir: string;
  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-hosted-form-")));
    const store = new ArtifactStore(dir);
    await store.initialize();
    const input = documentGenerationInput();
    input.job.url = url;
    const result = await buildPacket(store, input);
    packet = {
      manifest: result.manifest,
      content: result.content,
      valid: true,
      invalidReason: null,
    };
    browser = await chromium.launch();
  });
  beforeEach(async () => {
    for (const context of browser.contexts()) await context.close();
    page = await browser.newPage({ serviceWorkers: "block" });
    await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(url);
  });
  afterAll(async () => {
    await browser?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const target = () => ({ url, jobId: packet.manifest.jobId });
  const fill = async () => {
    const snapshot = await inspectHostedForm(page, target());
    return fillHostedForm(
      page,
      target(),
      packet,
      snapshot,
      planFields(snapshot, packet),
      packetEvidenceGuard(packet),
    );
  };
  it("maps labels, aria labels and aria-labelledby without trusting DOM semantics", async () => {
    await page
      .locator("#contact")
      .evaluate((element) => element.setAttribute("data-semantic-key", "sponsorship"));
    const snapshot = await inspectHostedForm(page, target());
    expect(snapshot.fields.map((field) => field.semanticKey)).toEqual([
      "full_name",
      "email",
      "phone",
    ]);
    expect(snapshot.blocker).toBe("none");
    const report = await fill();
    expect(report.status).toBe("ready");
    expect(report.readBack.every((entry) => entry.matches)).toBe(true);
  });
  it.each([
    '<input aria-label="Do you require sponsorship?" required>',
    '<input aria-label="Email" type="password">',
    '<input aria-label="Email" type="file">',
    '<input aria-label="Email" disabled>',
    '<input aria-label="Email" style="display:none" required>',
    '<div role="combobox" aria-label="Country"></div>',
    '<input aria-label="Email" list="suggestions"><datalist id="suggestions"></datalist>',
    '<input aria-label="Full name">',
  ])("stops on ambiguous, sensitive or unsupported controls", async (extra) => {
    await page
      .locator("form")
      .evaluate((form, fragment) => form.insertAdjacentHTML("beforeend", fragment), extra);
    expect((await inspectHostedForm(page, target())).blocker).not.toBe("none");
    await expect(fill()).rejects.toThrow("blocked");
    expect(await page.locator("#name").inputValue()).toBe("");
  });
  it("detects challenges and rejects ambiguous forms", async () => {
    await page
      .locator("form")
      .evaluate((form) =>
        form.insertAdjacentHTML("beforeend", '<div data-sitekey="synthetic"></div>'),
      );
    expect((await inspectHostedForm(page, target())).blocker).toBe("challenge");
    await page.evaluate(() =>
      document.body.insertAdjacentHTML("beforeend", '<form><input aria-label="Email"></form>'),
    );
    await expect(inspectHostedForm(page, target())).rejects.toThrow("ambiguous");
  });
  it("rejects changed form actions and forged plans before filling", async () => {
    const snapshot = await inspectHostedForm(page, target());
    const plan = planFields(snapshot, packet);
    const forged = structuredClone(plan);
    if (forged.entries[0]) forged.entries[0].expected = "Fabricated";
    await expect(
      fillHostedForm(page, target(), packet, snapshot, forged, packetEvidenceGuard(packet)),
    ).rejects.toThrow("packet-backed");
    await page.locator("form").evaluate((form) => form.setAttribute("action", "/other"));
    await expect(
      fillHostedForm(page, target(), packet, snapshot, plan, packetEvidenceGuard(packet)),
    ).rejects.toThrow("changed");
  });
  it("blocks event-triggered network writes without clicking submit", async () => {
    await page.evaluate(() => {
      document.querySelector("#name")?.addEventListener("input", () => {
        void fetch("/applications", { method: "POST" }).catch(() => {});
      });
    });
    const report = await fill();
    expect(report.status).toBe("unsupported");
    expect(report.issues.join(" ")).toContain("network activity");
  });
  it("rereads earlier controls after later fields change them", async () => {
    await page.evaluate(() => {
      document.querySelector("#phone")?.addEventListener("input", () => {
        const field = document.querySelector<HTMLInputElement>("#name");
        if (field) field.value = "Altered after filling";
      });
    });
    const report = await fill();
    expect(report.status).toBe("unsupported");
    expect(report.readBack[0]?.matches).toBe(false);
  });
  it("refuses native validation failures despite exact text readback", async () => {
    await page
      .locator("#contact")
      .evaluate((element) => element.setAttribute("pattern", "never-matches"));
    const report = await fill();
    expect(report.status).toBe("unsupported");
    expect(report.readBack.find((entry) => entry.name === "control_2")?.matches).toBe(false);
  });
  it("refuses mismatched semantic input types", async () => {
    await page.locator("#phone").evaluate((element) => element.setAttribute("type", "email"));
    expect((await inspectHostedForm(page, target())).blocker).toBe("unsupported");
  });
  it("rejects revoked guards, wrong vacancy URLs and GET forms", async () => {
    const snapshot = await inspectHostedForm(page, target());
    const plan = planFields(snapshot, packet);
    await expect(
      fillHostedForm(page, target(), packet, snapshot, plan, async () => {
        throw new Error("Revoked");
      }),
    ).rejects.toThrow("approval");
    await expect(
      inspectHostedForm(page, { ...target(), url: "https://other.test/jobs/123" }),
    ).rejects.toThrow("approved");
    await page.locator("form").evaluate((form) => form.setAttribute("method", "get"));
    expect((await inspectHostedForm(page, target())).blocker).toBe("unsupported");
  });
});
