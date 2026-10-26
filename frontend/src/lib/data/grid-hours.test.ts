import type { UserDocPatch } from "@calgy/shared";
import { describe, expect, test, vi } from "vitest";
import { createInferredHoursSync, INFERRED_DEBOUNCE_MS } from "./grid-hours";
import { inferredHoursChanged } from "./mapping";

const inferred = (value: number, range: [number, number] | null = [5, 8]) => ({ source: "inferred" as const, value, inferredRange: range });

describe("inferredHoursChanged", () => {
  test("only ≥ 0.5h moves count", () => {
    expect(inferredHoursChanged(inferred(6), inferred(6.4))).toBe(false);
    expect(inferredHoursChanged(inferred(6), inferred(6.5))).toBe(true);
    expect(inferredHoursChanged(inferred(6), inferred(5.5))).toBe(true);
  });
  test("a new range always counts", () => {
    expect(inferredHoursChanged(inferred(6), inferred(6.1, [5, 9]))).toBe(true);
  });
  test("switching source counts", () => {
    expect(inferredHoursChanged({ source: "none", value: 8, inferredRange: null }, inferred(8))).toBe(true);
  });
});

describe("inferred hours sync", () => {
  test("debounced 10s, sends the last value only when it moved enough", () => {
    vi.useFakeTimers();
    try {
      let current = inferred(6);
      const send = vi.fn((p: UserDocPatch) => {
        current = p.gridHours as ReturnType<typeof inferred>;
      });
      const s = createInferredHoursSync({ current: () => current, send });

      s.schedule(inferred(6.2));
      vi.advanceTimersByTime(INFERRED_DEBOUNCE_MS);
      expect(send).not.toHaveBeenCalled(); // < 0.5h
      expect(s.latest()).toEqual(inferred(6.2)); // still used in memory

      s.schedule(inferred(6.6));
      vi.advanceTimersByTime(INFERRED_DEBOUNCE_MS - 1);
      s.schedule(inferred(7));
      vi.advanceTimersByTime(INFERRED_DEBOUNCE_MS - 1);
      expect(send).not.toHaveBeenCalled(); // timer restarted
      vi.advanceTimersByTime(1);
      expect(send).toHaveBeenCalledExactlyOnceWith({ gridHours: inferred(7) });
    } finally {
      vi.useRealTimers();
    }
  });

  test("flush sends a due change immediately", () => {
    const send = vi.fn();
    const s = createInferredHoursSync({ current: () => inferred(4), send });
    s.schedule(inferred(6));
    s.flush();
    expect(send).toHaveBeenCalledOnce();
    s.cancel();
  });
});
