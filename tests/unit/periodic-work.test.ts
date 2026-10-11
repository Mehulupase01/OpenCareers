import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPeriodicWork } from "../../apps/worker/src/periodic-work.js";

describe("single-flight periodic database work", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("skips ticks during slow work and drains exactly one pending operation on stop", async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = vi.fn(() => blocked);
    const pulse = startPeriodicWork(100, work, vi.fn());
    await vi.advanceTimersByTimeAsync(100000);
    expect(work).toHaveBeenCalledTimes(1);
    let drained = false;
    const stopped = pulse.stop().then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(100000);
    expect(drained).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
    release();
    await stopped;
    expect(drained).toBe(true);
    await vi.advanceTimersByTimeAsync(100000);
    expect(work).toHaveBeenCalledTimes(1);
    await pulse.stop();
  });
  it("can retry on a later tick after rejection without accumulating queued work", async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue(undefined);
    const diagnostic = vi.fn();
    const pulse = startPeriodicWork(100, work, diagnostic);
    await vi.advanceTimersByTimeAsync(100);
    expect(diagnostic).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(work).toHaveBeenCalledTimes(2);
    await pulse.stop();
  });
  it("releases its slot after synchronous work and diagnostic failures", async () => {
    const work = vi.fn(() => {
      throw new Error("synthetic synchronous failure");
    });
    const pulse = startPeriodicWork(100, work, () => {
      throw new Error("synthetic diagnostic failure");
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(work).toHaveBeenCalledTimes(2);
    await pulse.stop();
  });
  it("does not start work after stop or accept an unbounded polling interval", async () => {
    const work = vi.fn();
    for (const interval of [0, -1, 19, 60001, Number.NaN, 20.5])
      expect(() => startPeriodicWork(interval, work, vi.fn())).toThrow("outside its bound");
    const pulse = startPeriodicWork(100, work, vi.fn());
    await pulse.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(work).not.toHaveBeenCalled();
  });
});
