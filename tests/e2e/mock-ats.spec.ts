import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fillStep, inspectForm, planFields } from "../../packages/browser/src/adapter.js";
import { prepareMockPacket } from "../../packages/browser/src/prepare.js";
import { launchDryRunBrowser } from "../../packages/browser/src/runtime.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { startMockAts } from "../../packages/mock-ats/src/server.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

let packet: PacketSnapshot;
let cvPdf: Buffer;
let artifactDir: string;

test.beforeAll(async () => {
  artifactDir = await realpath(await mkdtemp(join(tmpdir(), "opencareers-mock-ats-")));
  const store = new ArtifactStore(artifactDir);
  await store.initialize();
  const base = documentGenerationInput();
  const job = {
    ...base.job,
    id: "synthetic-engineer-1",
    company: "Synthetic Employer",
    title: "Software Engineer",
  };
  const assessment = { ...base.assessment, jobId: job.id };
  const built = await buildPacket(store, { ...base, job, assessment });
  packet = { manifest: built.manifest, content: built.content, valid: true, invalidReason: null };
  const artifact = built.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!artifact) throw new Error("Synthetic CV PDF missing.");
  cvPdf = await store.read(artifact.storageKey, artifact.sha256);
});

test.afterAll(async () => {
  if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
});

test("mock ATS read-back and upload reach dry-run readiness without a submission", async () => {
  const mock = await startMockAts();
  const owned = await launchDryRunBrowser(mock.url);
  try {
    await owned.page.goto(`${mock.url}/jobs/standard`);
    await owned.page.evaluate(() => {
      const status = document.querySelector("[data-upload-status]");
      if (!status) throw new Error("Upload status missing.");
      const observed = [status.getAttribute("data-upload-status")];
      (
        window as typeof window & { observedUploadStates: Array<string | null> }
      ).observedUploadStates = observed;
      new MutationObserver(() => observed.push(status.getAttribute("data-upload-status"))).observe(
        status,
        { attributes: true, attributeFilter: ["data-upload-status"] },
      );
    });
    const first = inspectForm(owned.page);
    const plan = planFields(await first, packet, { country: "NL" });
    const filled = await fillStep(owned.page, plan, cvPdf);
    expect(filled.status).toBe("ready");
    expect(filled.uploadStatus).toBe("accepted");
    expect(
      await owned.page.evaluate(
        () =>
          (window as typeof window & { observedUploadStates: Array<string | null> })
            .observedUploadStates,
      ),
    ).toEqual(["idle", "selected", "uploading", "accepted"]);
    expect(filled.readBack.every((item) => item.matches)).toBe(true);
    await owned.page.getByRole("button", { name: "Next" }).click();
    const second = await inspectForm(owned.page);
    expect(second.step).toBe(2);
    const secondPlan = planFields(second, packet, {
      sponsorship_required: "no",
      available_from: "2026-11-01",
      remote_preference: "yes",
      terms: true,
    });
    const secondFill = await fillStep(owned.page, secondPlan, cvPdf);
    expect(secondFill.status).toBe("ready");
    expect(secondFill.readBack.find((item) => item.name === "remote_preference")).toMatchObject({
      expected: "yes",
      actual: "yes",
      matches: true,
    });
    await owned.page
      .locator('[name="portfolio"]')
      .press("Enter")
      .catch(() => undefined);
    expect(owned.blockedCommitCount).toBeGreaterThan(0);
    await owned.page
      .getByRole("button", { name: "Submit application" })
      .click()
      .catch(() => undefined);
    expect(owned.blockedCommitCount).toBeGreaterThan(0);
    const records = await mock.app.inject({ url: "/__test/records" });
    expect(records.json().count).toBe(0);
  } finally {
    await owned.close();
    await mock.app.close();
  }
});

test("packet-bound orchestration reaches READY and catches resume parser drift", async () => {
  const approved = {
    country: "NL",
    sponsorship_required: "no",
    available_from: "2026-11-01",
    remote_preference: "yes",
    terms: true,
  };
  const ready = await prepareMockPacket(packet, cvPdf, approved);
  expect(ready.status).toBe("ready");
  expect(ready.snapshots).toHaveLength(2);
  expect(ready.serverApplicationCount).toBe(0);
  const overwritten = await prepareMockPacket(packet, cvPdf, approved, "resume-overwrite");
  expect(overwritten.status).toBe("needs_input");
  expect(overwritten.issues).toContain(
    "Resume parsing changed full_name after the first read-back.",
  );
});

test("changed question and conditional answer invalidate the prior plan", async () => {
  const mock = await startMockAts();
  const owned = await launchDryRunBrowser(mock.url);
  try {
    await owned.page.goto(`${mock.url}/jobs/standard`);
    await owned.page.getByRole("button", { name: "Next" }).click();
    const initial = planFields(await inspectForm(owned.page), packet, {
      sponsorship_required: "yes",
    });
    await owned.page.goto(`${mock.url}/jobs/changed-question`);
    await owned.page.getByRole("button", { name: "Next" }).click();
    await expect(fillStep(owned.page, initial, cvPdf)).rejects.toThrow("Form questions changed");
    const updated = planFields(await inspectForm(owned.page), packet, {
      sponsorship_required: "yes",
    });
    const filled = await fillStep(owned.page, updated, cvPdf);
    expect(filled.status).toBe("needs_input");
    expect(filled.issues).toContain(
      "Conditional questions changed; a new answer plan is required.",
    );
    expect(filled.snapshot.fields.some((field) => field.semanticKey === "sponsorship_detail")).toBe(
      true,
    );
  } finally {
    await owned.close();
    await mock.app.close();
  }
});

test("upload failure and challenge remain scoped while another job can proceed", async () => {
  const mock = await startMockAts();
  const owned = await launchDryRunBrowser(mock.url);
  try {
    await owned.page.goto(`${mock.url}/jobs/upload-fail`);
    const failure = await fillStep(
      owned.page,
      planFields(await inspectForm(owned.page), packet, { country: "NL" }),
      cvPdf,
    );
    expect(failure.status).toBe("upload_failed");
    await owned.page.goto(`${mock.url}/jobs/challenge`);
    const challenge = await fillStep(
      owned.page,
      planFields(await inspectForm(owned.page), packet, { country: "NL" }),
      cvPdf,
    );
    expect(challenge.status).toBe("challenge");
    await owned.page.goto(`${mock.url}/jobs/standard`);
    expect((await inspectForm(owned.page)).blocker).toBe("none");
    expect((await mock.app.inject({ url: "/__test/records" })).json().count).toBe(0);
  } finally {
    await owned.close();
    await mock.app.close();
  }
});

test("resume overwrite and implicit submission are observable without creating receipts", async () => {
  const mock = await startMockAts();
  const owned = await launchDryRunBrowser(mock.url);
  try {
    await owned.page.goto(`${mock.url}/jobs/resume-overwrite`);
    await fillStep(
      owned.page,
      planFields(await inspectForm(owned.page), packet, { country: "NL" }),
      cvPdf,
    );
    await owned.page.getByRole("button", { name: "Next" }).click();
    expect(await owned.page.locator('[name="full_name"]').inputValue()).toBe("Parsed Wrong Name");
    await owned.page.goto(`${mock.url}/jobs/implicit-submit`);
    await owned.page.locator('[name="country"]').selectOption("NL");
    await expect.poll(() => owned.blockedCommitCount).toBeGreaterThan(0);
    await owned.page.goto(`${mock.url}/jobs/misleading-banner`);
    await expect(owned.page.getByText("Thanks for your interest.", { exact: false })).toBeVisible();
    expect((await mock.app.inject({ url: "/__test/records" })).json().count).toBe(0);
  } finally {
    await owned.close();
    await mock.app.close();
  }
});

test("mock server counts applications only after accepted form submission", async () => {
  const mock = await startMockAts();
  try {
    const account = await fetch(`${mock.url}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alex@synthetic.example" }),
    });
    expect(account.status).toBe(201);
    expect((await mock.app.inject({ url: "/__test/records" })).json()).toMatchObject({
      count: 0,
      accountCount: 1,
    });
    const uploadBody = new FormData();
    uploadBody.append(
      "file",
      new Blob([new Uint8Array(cvPdf)], { type: "application/pdf" }),
      "cv.pdf",
    );
    const upload = await fetch(`${mock.url}/uploads`, { method: "POST", body: uploadBody });
    expect(upload.status).toBe(200);
    const uploadId = (await upload.json()).id as string;
    const fields = new URLSearchParams({
      fixture: "standard",
      job_id: "synthetic-engineer-1",
      full_name: "Alex Example",
      email: "alex@synthetic.example",
      phone: "+31 20 000 0000",
      country: "NL",
      motivation: "I am applying for this synthetic engineering role.",
      sponsorship: "no",
      available_from: "2026-11-01",
      remote_preference: "yes",
      portfolio: "https://portfolio.synthetic.example/alex",
      terms: "on",
      upload_id: uploadId,
    });
    const invalid = await fetch(`${mock.url}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(fields), upload_id: "missing" }),
      redirect: "manual",
    });
    expect(invalid.status).toBe(422);
    const accepted = await fetch(`${mock.url}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fields,
      redirect: "manual",
    });
    expect(accepted.status).toBe(302);
    const records = (await mock.app.inject({ url: "/__test/records" })).json();
    expect(records).toMatchObject({ count: 1, accountCount: 1 });
    const receipt = await fetch(new URL(accepted.headers.get("location") ?? "", mock.url));
    expect(await receipt.text()).toContain(records.records[0].id);
  } finally {
    await mock.app.close();
  }
});
