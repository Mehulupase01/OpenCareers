import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { selectWorkerTask } from "../../apps/worker/src/task-selection.js";
import { createAdapterRegistry } from "../../packages/browser/src/adapter-sdk.js";
import { browserResources } from "../../packages/browser/src/resources.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { startMockAts } from "../../packages/mock-ats/src/server.js";
import { DocumentRepository } from "../../packages/persistence/src/document-repository.js";
import { connect } from "../../packages/persistence/src/index.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { SubmissionRepository } from "../../packages/persistence/src/submission-repository.js";
import { createCapacityFixture } from "../../scripts/capacity-fixture.js";

it("recovers an accepted lost-response lease before inference or higher-priority ordinary work, without replay", async () => {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), "opencareers-capacity-scheduler-"),
  );
  const repository = await connect({ ...loadConfig({}), dataDir: directory });
  try {
    const cycle = await createCapacityFixture(repository, directory, {
      afterAcceptedResponseLoss: async () => {
        throw new Error("Synthetic scheduler interruption after acceptance.");
      },
    });
    await expect(cycle("response-loss")).rejects.toThrow(
      "Synthetic scheduler interruption after acceptance.",
    );
    const outstanding = (
      await repository.db.query(
        "SELECT id,lease_until FROM tasks WHERE owner_id=$1 AND type='submit' AND state='leased'",
        [repository.ownerId],
      )
    )[0];
    expect(outstanding).toBeDefined();
    if (!outstanding) throw new Error("Expected a leased synthetic submission.");
    expect(
      await repository.db.query("SELECT state FROM attempts WHERE owner_id=$1", [
        repository.ownerId,
      ]),
    ).toEqual([{ state: "IN_FLIGHT" }]);
    // Logical lease expiry is explicit; this is not an elapsed outage or process kill.
    const clock = () => new Date(Date.parse(String(outstanding.lease_until)) + 1);
    const replacement = new Repository(repository.db, repository.ownerId, clock);
    await replacement.enqueue({
      type: "demo_probe",
      domain: "synthetic-independent-work",
      priority: 1000,
      dedupeKey: "scheduler:ordinary-backlog",
    });
    const assess = vi.fn(async () => undefined);
    const routeReady = vi.fn(async () => true);
    const options = {
      profile: "demo" as const,
      externalSubmissionEnabled: false,
      hasLetterRunner: false,
      claim: (types: Parameters<Repository["claim"]>[1]) =>
        replacement.claim("recovery-first-worker", types),
      assess,
      routeReady,
    };
    const recovery = await selectWorkerTask(options);
    expect(recovery?.type).toBe("reconcile");
    expect(assess).not.toHaveBeenCalled();
    expect(routeReady).not.toHaveBeenCalled();
    expect(
      await repository.db.query("SELECT state FROM tasks WHERE owner_id=$1 AND id=$2", [
        repository.ownerId,
        String(outstanding.id),
      ]),
    ).toEqual([{ state: "cancelled" }]);
    expect(await replacement.claim("duplicate-submit-worker", ["submit"])).toBeNull();
    expect(
      await repository.db.query("SELECT state FROM attempts WHERE owner_id=$1", [
        repository.ownerId,
      ]),
    ).toEqual([{ state: "UNKNOWN" }]);
    if (!recovery) throw new Error("Expected recovery task.");
    const packet = (await new DocumentRepository(repository.db, repository.ownerId).snapshot())[0];
    if (!packet) throw new Error("Expected retained synthetic packet.");
    const adapter = createAdapterRegistry(directory).get("mock-ats");
    const evidence = await adapter.reconcile({
      packet,
      target: adapter.parseTarget({ fixture: "response-loss" }),
    });
    expect(
      await new SubmissionRepository(repository.db, repository.ownerId, clock).reconcileReceipt(
        recovery,
        evidence,
      ),
    ).toBe("confirmed");
    await replacement.complete(recovery);
    const ordinary = await selectWorkerTask(options);
    expect(ordinary?.type).toBe("demo_probe");
    expect(assess).toHaveBeenCalledExactlyOnceWith(1);
    if (ordinary) await replacement.complete(ordinary);
    expect(
      await repository.db.query("SELECT state FROM attempts WHERE owner_id=$1", [
        repository.ownerId,
      ]),
    ).toEqual([{ state: "CONFIRMED" }]);
    expect(
      await repository.db.query("SELECT id FROM receipts WHERE owner_id=$1", [repository.ownerId]),
    ).toHaveLength(1);
    const mock = await startMockAts(join(directory, "mock-ats-records"));
    try {
      expect((await mock.app.inject({ url: "/__test/records" })).json().count).toBe(1);
    } finally {
      await mock.app.close();
    }
    expect(browserResources.snapshot()).toMatchObject({ browsers: 0, contexts: 0 });
  } finally {
    await repository.db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
