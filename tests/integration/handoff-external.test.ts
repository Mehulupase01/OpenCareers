import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisibleHandoffBroker } from "../../packages/browser/src/handoff-broker.js";
import { dryRunResultSchema } from "../../packages/contracts/src/browser.js";
import { openSqlite } from "../../packages/persistence/src/database.js";
import { HandoffRepository } from "../../packages/persistence/src/handoff-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { type HandoffFixture, startHandoffFixture } from "../helpers/handoff-fixture.js";

const minutes = (value: number) => value * 60_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/**
 * SQLite only. The external handoff adds no SQL of its own; what it adds is a
 * browser policy, and the repository contract for handoffs is already exercised
 * on both engines by tests/integration/handoff.test.ts.
 */
describe("external adapter challenge handoff", () => {
  let owner: string;
  let applicationId: string;
  let preparationId: string;
  let targetFingerprint: string;
  let fixture: HandoffFixture;
  let repository: HandoffRepository;
  let brokers: VisibleHandoffBroker[] = [];
  let close: () => Promise<void> = async () => undefined;

  const seed = async (adapterId: string, url: string) => {
    const db = await openSqlite(":memory:");
    close = async () => {
      for (const broker of brokers) await broker.closeAll();
      await db.close();
    };
    await migrate(db);
    owner = `handoff-external-${randomUUID()}`;
    await new Repository(db, owner).initialize();
    const candidateId = randomUUID();
    applicationId = randomUUID();
    preparationId = randomUUID();
    const packetId = randomUUID();
    const jobId = randomUUID();
    targetFingerprint = createHash("sha256").update(JSON.stringify({ adapterId })).digest("hex");
    await db.query("INSERT INTO candidates(owner_id,id) VALUES($1,$2)", [owner, candidateId]);
    await db.query(
      "INSERT INTO jobs(owner_id,id,employer_id,requisition_id,data,created_at,last_seen_at) VALUES($1,$2,'synthetic-employer','req','{}',$3,$3)",
      [owner, jobId, at(0)],
    );
    await db.query(
      "INSERT INTO applications(owner_id,id,candidate_id,job_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,'CHALLENGE_REQUIRED',$5,$5)",
      [owner, applicationId, candidateId, jobId, at(0)],
    );
    await db.query(
      "INSERT INTO packets(owner_id,id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,'{}',$4,$5)",
      [owner, packetId, applicationId, "b".repeat(64), at(0)],
    );
    const snapshot = {
      url,
      origin: new URL(url).origin,
      jobId,
      step: 1,
      fields: [],
      fingerprint: "c".repeat(64),
      blocker: "challenge" as const,
    };
    const result = dryRunResultSchema.parse({
      adapter: { id: adapterId, version: "greenhouse-hosted-v1", targetFingerprint },
      packetId,
      applicationId,
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
    await db.query(
      "INSERT INTO browser_preparations(owner_id,id,application_id,packet_id,status,form_fingerprint,result,created_at,expires_at) VALUES($1,$2,$3,$4,'challenge',$5,$6,$7,$8)",
      [
        owner,
        preparationId,
        applicationId,
        packetId,
        snapshot.fingerprint,
        JSON.stringify(result),
        at(0),
        at(minutes(15)),
      ],
    );
    repository = new HandoffRepository(db, owner);
  };

  beforeEach(async () => {
    brokers = [];
    fixture = await startHandoffFixture();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await close();
    await fixture.close();
  });

  it("refuses an expired browser lease even when the session has not expired", async () => {
    await seed("greenhouse", `${fixture.url}/jobs/hosted`);
    const created = await repository.create({
      applicationId,
      preparationId,
      adapterId: "greenhouse",
      targetFingerprint,
    });
    const session = await repository.claimHandoff(created.session.id, created.token, "browser:ext");
    const target = await repository.target(created.session.id);
    await expect(
      broker().open({ ...session, leaseUntil: at(-1000) }, target.result, "browser:ext"),
    ).rejects.toMatchObject({ code: "LEASE_STALE" });
    const active = broker();
    await active.open(session, target.result, "browser:ext");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(session.leaseUntil ?? session.expiresAt) + 1);
    await expect(active.verify(session.id, session.generation)).rejects.toMatchObject({
      code: "LEASE_STALE",
    });
  });

  const broker = (onOpened?: (page: import("playwright").Page) => Promise<void>) => {
    const instance = new VisibleHandoffBroker(
      onOpened ? { visible: false, onOpened } : { visible: false },
    );
    brokers.push(instance);
    return instance;
  };

  it("opens the exact prepared portal page and completes once the challenge clears", async () => {
    await seed("greenhouse", `${fixture.url}/jobs/hosted`);
    const created = await repository.create({
      applicationId,
      preparationId,
      adapterId: "greenhouse",
      targetFingerprint,
    });
    const session = await repository.claimHandoff(created.session.id, created.token, "browser:ext");
    const target = await repository.target(created.session.id);

    // Before the owner acts, the challenge is still outstanding.
    const pending = broker();
    await pending.open(session, target.result, "browser:ext");
    await expect(pending.verify(created.session.id, session.generation)).rejects.toMatchObject({
      code: "STATE_INVALID",
      message: "Complete the verification step before continuing.",
    });
    await pending.closeAll();
    await repository.cancelClaim(created.session.id, "browser:ext", session.generation);

    // The owner clears the challenge, then the handoff completes.
    const active = broker(async (page) => {
      await page.getByRole("button", { name: "I am not a robot" }).click();
    });
    const reopened = await repository.create({
      applicationId,
      preparationId,
      adapterId: "greenhouse",
      targetFingerprint,
    });
    const claimed = await repository.claimHandoff(
      reopened.session.id,
      reopened.token,
      "browser:ext",
    );
    const reopenedTarget = await repository.target(reopened.session.id);
    await active.open(claimed, reopenedTarget.result, "browser:ext");
    await expect(active.verify(reopened.session.id, claimed.generation)).resolves.toMatchObject({
      leaseOwner: "browser:ext",
    });
    const completed = await repository.completeHandoff(
      reopened.session.id,
      "browser:ext",
      claimed.generation,
    );
    expect(completed.state).toBe("rebuilding");
    expect(fixture.finalActionAttempts()).toBe(0);
  });

  it("blocks the final application action and proves the employer received nothing", async () => {
    await seed("greenhouse", `${fixture.url}/jobs/hosted`);
    const created = await repository.create({
      applicationId,
      preparationId,
      adapterId: "greenhouse",
      targetFingerprint,
    });
    const session = await repository.claimHandoff(created.session.id, created.token, "browser:ext");
    const target = await repository.target(created.session.id);
    const active = broker(async (page) => {
      await page.getByRole("button", { name: "I am not a robot" }).click();
      await page.evaluate(() => {
        const form = document.querySelector("form");
        if (form instanceof HTMLFormElement) HTMLFormElement.prototype.submit.call(form);
      });
    });
    await active.open(session, target.result, "browser:ext");
    await expect
      .poll(async () => {
        try {
          await active.verify(created.session.id, session.generation);
          return "allowed";
        } catch (error) {
          return error instanceof Error ? error.message : "rejected";
        }
      })
      .toContain("final application action");
    expect(fixture.finalActionAttempts()).toBe(0);
  });

  it("does not mistake a vanished challenge and vanished form for completion", async () => {
    await seed("greenhouse", `${fixture.url}/jobs/hosted`);
    const created = await repository.create({
      applicationId,
      preparationId,
      adapterId: "greenhouse",
      targetFingerprint,
    });
    const session = await repository.claimHandoff(created.session.id, created.token, "browser:ext");
    const target = await repository.target(created.session.id);
    const active = broker(async (page) => {
      await page.getByRole("button", { name: "I am not a robot" }).click();
      await page.locator("form").evaluate((form) => form.remove());
    });
    await active.open(session, target.result, "browser:ext");
    await expect(active.verify(session.id, session.generation)).rejects.toMatchObject({
      code: "FORM_CHANGED",
    });
    expect(fixture.finalActionAttempts()).toBe(0);
  });

  it("refuses an adapter that declares no handoff capability", async () => {
    await seed("workday", `${fixture.url}/jobs/hosted`);
    const created = await repository.create({
      applicationId,
      preparationId,
      adapterId: "workday",
      targetFingerprint,
    });
    const session = await repository.claimHandoff(created.session.id, created.token, "browser:ext");
    const target = await repository.target(created.session.id);
    const active = broker();
    await expect(active.open(session, target.result, "browser:ext")).rejects.toMatchObject({
      code: "STATE_INVALID",
    });
  });

  it("refuses a drifted target fingerprint before any browser is opened", async () => {
    await seed("greenhouse", `${fixture.url}/jobs/hosted`);
    const created = await repository
      .create({
        applicationId,
        preparationId,
        adapterId: "greenhouse",
        targetFingerprint: "d".repeat(64),
      })
      .catch((error: Error & { code?: string }) => {
        expect(error.code).toBe("FORM_CHANGED");
        return null;
      });
    expect(created).toBeNull();
  });
});
