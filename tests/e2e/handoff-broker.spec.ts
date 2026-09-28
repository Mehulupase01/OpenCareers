import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { VisibleHandoffBroker } from "../../packages/browser/src/handoff-broker.js";
import { dryRunResultSchema } from "../../packages/contracts/src/browser.js";
import { handoffSessionSchema } from "../../packages/contracts/src/handoff.js";

const targetFingerprint = createHash("sha256")
  .update(JSON.stringify({ fixture: "challenge" }))
  .digest("hex");

const session = handoffSessionSchema.parse({
  id: randomUUID(),
  applicationId: randomUUID(),
  preparationId: randomUUID(),
  adapterId: "mock-ats",
  targetFingerprint,
  state: "claimed",
  generation: 1,
  leaseUntil: "2026-09-28T20:05:00.000Z",
  expiresAt: "2026-09-28T20:10:00.000Z",
  createdAt: "2026-09-28T20:00:00.000Z",
  completedAt: null,
});

const result = dryRunResultSchema.parse({
  adapter: { id: "mock-ats", version: "mock-ats-v1", targetFingerprint },
  packetId: randomUUID(),
  applicationId: session.applicationId,
  status: "challenge",
  snapshots: [
    {
      url: "http://127.0.0.1:4320/jobs/challenge",
      origin: "http://127.0.0.1:4320",
      jobId: "synthetic-job",
      step: 1,
      fields: [],
      fingerprint: "a".repeat(64),
      blocker: "challenge",
    },
  ],
  plans: [{ fingerprint: "a".repeat(64), entries: [], unresolved: [] }],
  reports: [
    {
      snapshot: {
        url: "http://127.0.0.1:4320/jobs/challenge",
        origin: "http://127.0.0.1:4320",
        jobId: "synthetic-job",
        step: 1,
        fields: [],
        fingerprint: "a".repeat(64),
        blocker: "challenge",
      },
      status: "challenge",
      readBack: [],
      uploadStatus: "idle",
      issues: ["Verification challenge requires owner action."],
    },
  ],
  issues: ["Verification challenge requires owner action."],
  blockedFinalActions: 0,
  serverApplicationCount: 0,
  preparedAt: "2026-09-28T20:00:00.000Z",
});

test("broker accepts the scoped challenge action and verifies the fenced generation", async () => {
  const broker = new VisibleHandoffBroker({
    visible: false,
    onOpened: async (page) => {
      await page.getByRole("button", { name: "Continue" }).click();
    },
  });
  try {
    await broker.open(session, result, "browser:test");
    await expect(broker.verify(session.id, session.generation)).resolves.toEqual({
      leaseOwner: "browser:test",
    });
    await expect(broker.verify(session.id, session.generation + 1)).rejects.toMatchObject({
      code: "LEASE_STALE",
    });
  } finally {
    await broker.closeAll();
  }
});

test("broker rejects a final application action during the handoff", async () => {
  const broker = new VisibleHandoffBroker({
    visible: false,
    onOpened: async (page) => {
      await page.getByRole("button", { name: "Continue" }).click();
      await page.evaluate(() => {
        const form = document.querySelector("form");
        if (form instanceof HTMLFormElement) HTMLFormElement.prototype.submit.call(form);
      });
    },
  });
  try {
    await broker.open(session, result, "browser:test");
    await expect
      .poll(async () => {
        try {
          await broker.verify(session.id, session.generation);
          return "allowed";
        } catch (error) {
          return error instanceof Error ? error.message : "rejected";
        }
      })
      .toContain("final application action");
  } finally {
    await broker.closeAll();
  }
});
