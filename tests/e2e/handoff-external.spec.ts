import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { VisibleHandoffBroker } from "../../packages/browser/src/handoff-broker.js";
import { dryRunResultSchema } from "../../packages/contracts/src/browser.js";
import { handoffSessionSchema } from "../../packages/contracts/src/handoff.js";
import { startHandoffFixture } from "../helpers/handoff-fixture.js";

const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const targetFingerprint = createHash("sha256")
  .update(JSON.stringify({ adapterId: "greenhouse" }))
  .digest("hex");

const sessionFor = (url: string) => {
  const applicationId = randomUUID();
  return handoffSessionSchema.parse({
    id: randomUUID(),
    applicationId,
    preparationId: randomUUID(),
    adapterId: "greenhouse",
    targetFingerprint,
    state: "claimed",
    generation: 1,
    leaseUntil: at(5 * 60_000),
    expiresAt: at(10 * 60_000),
    createdAt: at(0),
    completedAt: null,
  });
};

const resultFor = (session: { applicationId: string; id: string }, url: string) => {
  const snapshot = {
    url,
    origin: new URL(url).origin,
    jobId: "synthetic-hosted-job",
    step: 1,
    fields: [],
    fingerprint: "a".repeat(64),
    blocker: "challenge" as const,
  };
  return dryRunResultSchema.parse({
    adapter: { id: "greenhouse", version: "greenhouse-hosted-v1", targetFingerprint },
    packetId: randomUUID(),
    applicationId: session.applicationId,
    status: "challenge",
    snapshots: [snapshot],
    plans: [{ fingerprint: snapshot.fingerprint, entries: [], unresolved: [] }],
    reports: [
      {
        snapshot,
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
};

test("an external adapter handoff opens its own prepared page and never reaches the final action", async () => {
  const fixture = await startHandoffFixture();
  const url = `${fixture.url}/jobs/hosted`;
  const session = sessionFor(url);
  const broker = new VisibleHandoffBroker({
    visible: false,
    onOpened: async (page) => {
      // The owner clears the challenge, then tries to submit anyway. The submit
      // must be refused by the policy, not by luck.
      await page.getByRole("button", { name: "I am not a robot" }).click();
      await page.locator("#full-name").fill("Synthetic Candidate");
      await page.locator("#email").fill("alex@synthetic.example");
      await page.locator("#motivation").fill("Synthetic motivation for the handoff test.");
      await page.locator("#submit").click({ force: true });
    },
  });
  try {
    await broker.open(session, resultFor(session, url), "browser:e2e");
    await expect(broker.verify(session.id, session.generation)).rejects.toMatchObject({
      code: "STATE_INVALID",
    });
    // The fixture is the employer here: it counts what actually arrived.
    expect(fixture.finalActionAttempts()).toBe(0);
    await expect(broker.verify(session.id, session.generation + 1)).rejects.toMatchObject({
      code: "LEASE_STALE",
    });
  } finally {
    await broker.closeAll();
    await fixture.close();
  }
});
