import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertTransition,
  localDay,
  localDayStart,
  retryDelay,
} from "../../packages/domain/src/state.js";

describe("application state and recovery", () => {
  it("cannot relaunch an uncertain application or reopen a confirmed one", () => {
    for (const from of ["IN_FLIGHT", "UNKNOWN", "RECONCILING", "CONFIRMED"] as const) {
      expect(() => assertTransition(from, "READY")).toThrow();
      expect(() => assertTransition(from, "PREPARING")).toThrow();
    }
    expect(() => assertTransition("IN_FLIGHT", "UNKNOWN")).not.toThrow();
    expect(() => assertTransition("UNKNOWN", "RECONCILING")).not.toThrow();
    expect(() => assertTransition("READY", "INSPECTING")).not.toThrow();
  });
  it("bounds backoff regardless of attempt count and jitter", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (attempt, jitter) => {
          const delay = retryDelay(attempt, () => jitter);
          expect(delay).toBeGreaterThanOrEqual(750);
          expect(delay).toBeLessThanOrEqual(375000);
        },
      ),
    );
  });
  it("uses Netherlands days across daylight-saving boundaries", () => {
    expect(localDay(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
    expect(localDay(new Date("2026-10-25T00:30:00Z"))).toBe("2026-10-25");
    expect(localDay(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
    expect(localDayStart(new Date("2026-01-15T12:00:00Z")).toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
    expect(localDayStart(new Date("2026-07-15T12:00:00Z")).toISOString()).toBe(
      "2026-07-14T22:00:00.000Z",
    );
  });
});
