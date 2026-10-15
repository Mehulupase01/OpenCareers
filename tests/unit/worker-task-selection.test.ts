import { describe, expect, it, vi } from "vitest";
import { selectWorkerTask } from "../../apps/worker/src/task-selection.js";
import {
  type Task,
  taskPayloadSchema,
  taskTypeSchema,
} from "../../packages/contracts/src/index.js";

type Options = Parameters<typeof selectWorkerTask>[0];
const recovery: Task = {
  id: "task-recovery",
  ownerId: "owner-fixture",
  applicationId: "application-fixture",
  type: taskTypeSchema.parse("reconcile"),
  domain: "fixture.invalid",
  state: "leased",
  payload: taskPayloadSchema.parse({ schemaVersion: 1 }),
  fence: 1,
  attempts: 1,
  maxAttempts: 3,
  runAfter: "2026-10-15T00:00:00.000Z",
  leaseUntil: "2026-10-15T00:01:00.000Z",
  leaseOwner: "worker-fixture",
  lastError: null,
};

function setup(overrides: Partial<Options> = {}) {
  return {
    profile: "local" as const,
    externalSubmissionEnabled: true,
    hasLetterRunner: true,
    ...overrides,
    claim: vi.fn<Options["claim"]>(overrides.claim ?? (async () => null)),
    assess: vi.fn<Options["assess"]>(overrides.assess ?? (async () => undefined)),
    routeReady: vi.fn<Options["routeReady"]>(overrides.routeReady ?? (async () => true)),
  };
}

describe("worker task selection", () => {
  it("returns recovery before assessment or route checks for private external and demo workers", async () => {
    for (const profile of ["local", "demo"] as const) {
      const options = setup({ profile, externalSubmissionEnabled: profile === "local" });
      const claim = vi.fn<Options["claim"]>().mockResolvedValue(recovery);
      expect(await selectWorkerTask({ ...options, claim })).toBe(recovery);
      expect(claim.mock.calls).toEqual([[["reconcile"]]]);
      expect(options.assess).not.toHaveBeenCalled();
      expect(options.routeReady).not.toHaveBeenCalled();
    }
  });

  it("assesses exactly one after empty recovery, then checks routing and delegates normal claiming", async () => {
    const order: string[] = [];
    const prepare: Task = { ...recovery, id: "task-prepare", type: "prepare" };
    const claim = vi.fn<Options["claim"]>(async (types) => {
      order.push(`claim:${types.join(",")}`);
      return types.length === 1 ? null : prepare;
    });
    const assess = vi.fn<Options["assess"]>(async () => {
      order.push("assess");
    });
    const routeReady = vi.fn<Options["routeReady"]>(async () => {
      order.push("route");
      return true;
    });
    expect(await selectWorkerTask(setup({ claim, assess, routeReady }))).toBe(prepare);
    expect(assess.mock.calls).toEqual([[1]]);
    expect(routeReady).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "claim:reconcile",
      "assess",
      "route",
      "claim:prepare,inspect,submit,reconcile",
    ]);
  });

  it("keeps a network-disabled private worker without a letter runner at an empty claim, without routing", async () => {
    const claim = vi.fn<Options["claim"]>().mockResolvedValue(null);
    const options = setup({
      profile: "server",
      externalSubmissionEnabled: false,
      hasLetterRunner: false,
      claim,
    });
    expect(await selectWorkerTask(options)).toBeNull();
    expect(claim.mock.calls).toEqual([[[]]]);
    expect(options.assess).toHaveBeenCalledExactlyOnceWith(1);
    expect(options.routeReady).not.toHaveBeenCalled();
  });

  it("preserves demo task types even without a letter runner and never checks a model route", async () => {
    const claim = vi.fn<Options["claim"]>().mockResolvedValue(null);
    const options = setup({
      profile: "demo",
      externalSubmissionEnabled: false,
      hasLetterRunner: false,
      claim,
    });
    expect(await selectWorkerTask(options)).toBeNull();
    expect(claim.mock.calls).toEqual([
      [["reconcile"]],
      [["demo_probe", "prepare", "inspect", "submit", "reconcile"]],
    ]);
    expect(options.assess).toHaveBeenCalledExactlyOnceWith(1);
    expect(options.routeReady).not.toHaveBeenCalled();
  });

  it("falls back to inspection, submission and recovery when the private model route is unavailable", async () => {
    const claim = vi.fn<Options["claim"]>().mockResolvedValue(null);
    const routeReady = vi.fn<Options["routeReady"]>().mockResolvedValue(false);
    const options = setup({ claim, routeReady });
    expect(await selectWorkerTask(options)).toBeNull();
    expect(claim.mock.calls).toEqual([[["reconcile"]], [["inspect", "submit", "reconcile"]]]);
    expect(options.assess).toHaveBeenCalledExactlyOnceWith(1);
    expect(routeReady).toHaveBeenCalledTimes(1);
  });

  it("allows only preparation offline when its route is ready, otherwise delegates an empty claim", async () => {
    const claim = vi.fn<Options["claim"]>().mockResolvedValue(null);
    const routeReady = vi
      .fn<Options["routeReady"]>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const options = setup({ externalSubmissionEnabled: false, claim, routeReady });
    await selectWorkerTask(options);
    await selectWorkerTask(options);
    expect(claim.mock.calls).toEqual([[["prepare"]], [[]]]);
    expect(options.assess.mock.calls).toEqual([[1], [1]]);
    expect(routeReady).toHaveBeenCalledTimes(2);
  });
});
