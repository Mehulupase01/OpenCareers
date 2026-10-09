import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { VisibleHandoffBroker } from "../../packages/browser/src/handoff-broker.js";
import { dryRunResultSchema } from "../../packages/contracts/src/browser.js";
import { handoffSessionSchema } from "../../packages/contracts/src/handoff.js";

const targetFingerprint = createHash("sha256")
  .update(JSON.stringify({ fixture: "challenge" }))
  .digest("hex");

// The broker enforces absolute expiry, so these instants must be derived from the
// clock. A hardcoded date made this suite fail on any run after that instant,
// which is a test that rots rather than a behaviour that regressed.
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const session = handoffSessionSchema.parse({
  id: randomUUID(),
  applicationId: randomUUID(),
  preparationId: randomUUID(),
  adapterId: "mock-ats",
  targetFingerprint,
  state: "claimed",
  generation: 1,
  leaseUntil: at(5 * 60_000),
  expiresAt: at(10 * 60_000),
  createdAt: at(0),
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
  preparedAt: at(0),
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
    await expect(broker.verify(session.id, session.generation)).resolves.toMatchObject({
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
