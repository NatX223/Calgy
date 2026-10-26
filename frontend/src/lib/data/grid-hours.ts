// Light hours worked out from the meter. The latest value lives here in memory (calibration recomputes
// it on every screen); it's sent to the user doc at most every 10s, and only when it really moved.
import type { UserDoc, UserDocPatch } from "@calgy/shared";
import { inferredHoursChanged } from "./mapping";

export const INFERRED_DEBOUNCE_MS = 10_000;

type GridHours = UserDoc["gridHours"];
type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };

export function createInferredHoursSync(opts: {
  /** What the user doc says now. */
  current: () => GridHours;
  send: (patch: UserDocPatch) => void;
  timers?: Timers;
  debounceMs?: number;
}) {
  const timers: Timers = opts.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as number) };
  let latest: GridHours | null = null;
  let timer: unknown = null;

  const fire = () => {
    timer = null;
    if (latest && inferredHoursChanged(opts.current(), latest)) opts.send({ gridHours: latest });
  };

  return {
    /** The value the screens use until the doc catches up. */
    latest: () => latest,
    schedule(next: GridHours) {
      latest = next;
      if (timer != null) timers.clear(timer);
      timer = timers.set(fire, opts.debounceMs ?? INFERRED_DEBOUNCE_MS);
    },
    /** Send now if due (e.g. the tab is being hidden). */
    flush() {
      if (timer == null) return;
      timers.clear(timer);
      fire();
    },
    cancel() {
      if (timer != null) timers.clear(timer);
      timer = null;
      latest = null;
    },
  };
}
