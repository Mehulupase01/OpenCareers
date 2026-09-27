import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  greenhouseUrl,
  inspectGreenhouseForm,
} from "../../packages/browser/src/greenhouse-inspect.js";

describe("Greenhouse hosted form inspection", () => {
  let browser: Browser;
  let page: Page;
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
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.route(url, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: html }),
    );
    await page.goto(url);
  });

  afterAll(async () => browser?.close());

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

  it("reports challenge widgets before preparation", async () => {
    await page.evaluate(() => {
      const challenge = document.createElement("div");
      challenge.className = "h-captcha";
      document.body.append(challenge);
    });
    expect((await inspectGreenhouseForm(page, target)).blocker).toBe("challenge");
  });
});
