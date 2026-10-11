import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserResources } from "../../packages/browser/src/resources.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { startMockAts } from "../../packages/mock-ats/src/server.js";
import { connect } from "../../packages/persistence/src/index.js";
import type { Repository } from "../../packages/persistence/src/repository.js";
import { SubmissionRepository } from "../../packages/persistence/src/submission-repository.js";
import { createCapacityFixture } from "../../scripts/capacity-fixture.js";

describe("emergency stop at the guarded dispatch boundary", () => {
  let directory: string;
  let repository: Repository;
  beforeEach(async () => {
    directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers-capacity-stop-"));
    repository = await connect({ ...loadConfig({}), dataDir: directory });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await repository?.db.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("cannot mint a dispatch permit after stop or create a mock server record", async () => {
    const cycle = await createCapacityFixture(repository, directory);
    const authorize = SubmissionRepository.prototype.authorizeDispatch;
    vi.spyOn(SubmissionRepository.prototype, "authorizeDispatch").mockImplementationOnce(
      async function (this: SubmissionRepository, task, handle) {
        await repository.setControl({ stopped: true });
        return authorize.call(this, task, handle);
      },
    );
    await expect(cycle("standard")).rejects.toMatchObject({ code: "LEASE_STALE" });
    const attempts = await repository.db.query(
      "SELECT dispatch_started_at FROM attempts WHERE owner_id=$1",
      [repository.ownerId],
    );
    expect(attempts).toEqual([{ dispatch_started_at: null }]);
    expect((await repository.summary("demo")).flow.confirmedWithReceipt).toBe(0);
    expect(await repository.claim("replacement-worker", ["submit"])).toBeNull();
    const mock = await startMockAts(join(directory, "mock-ats-records"));
    try {
      expect((await mock.app.inject({ url: "/__test/records" })).json().count).toBe(0);
    } finally {
      await mock.app.close();
    }
    expect(browserResources.snapshot()).toMatchObject({ browsers: 0, contexts: 0 });
  }, 60000);

  it("retains an accepted-but-lost outcome through stop and reconciles read-only exactly once", async () => {
    const cycle = await createCapacityFixture(repository, directory);
    const reconcile = SubmissionRepository.prototype.reconcileReceipt;
    vi.spyOn(SubmissionRepository.prototype, "reconcileReceipt").mockImplementationOnce(
      async function (this: SubmissionRepository, task, evidence) {
        await repository.setControl({ stopped: true });
        const uncertain = await repository.summary("demo");
        expect(uncertain).toMatchObject({
          control: { stopped: true },
          counts: { unknown: 1 },
          flow: { confirmedWithReceipt: 0 },
        });
        expect(await repository.claim("replacement-worker", ["submit"])).toBeNull();
        return reconcile.call(this, task, evidence);
      },
    );
    expect(await cycle("response-loss")).toMatchObject({ outcome: "reconciled_confirmed" });
    expect(await repository.summary("demo")).toMatchObject({
      control: { stopped: true },
      counts: { unknown: 0 },
      flow: { confirmedWithReceipt: 1 },
    });
    const attempts = await repository.db.query(
      "SELECT state,dispatch_started_at FROM attempts WHERE owner_id=$1",
      [repository.ownerId],
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      state: "CONFIRMED",
      dispatch_started_at: expect.any(String),
    });
    expect(browserResources.snapshot()).toMatchObject({ browsers: 0, contexts: 0 });
  }, 60000);
});
