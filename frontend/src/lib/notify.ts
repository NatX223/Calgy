// App-wide toasts for things that happen outside a screen (failed background writes, sync, account).
type Note = { msg: string; actionLabel?: string; action?: () => void };
type Listener = (n: Note) => void;

const listeners = new Set<Listener>();

export function notify(msg: string, actionLabel?: string, action?: () => void) {
  listeners.forEach((l) => l({ msg, actionLabel, action }));
}

export function onNotify(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

let lastWriteError = 0;

/** A write the UI didn't wait for failed. At most one toast every 10s. */
export function reportWriteError(err: unknown) {
  if (process.env.NODE_ENV !== "production") console.error("Calgy: write failed", err);
  const now = Date.now();
  if (now - lastWriteError < 10_000) return;
  lastWriteError = now;
  const code = (err as { code?: string } | null)?.code;
  notify(code === "permission-denied" ? "Couldn't save that change: not allowed." : "Couldn't save a change. Try again.");
}
