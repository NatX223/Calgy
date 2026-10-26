"use client";

import { useSyncState } from "@/lib/hooks/status";

/** "Saved on this device · syncing…" / "Offline · …". Hidden when everything is synced. */
export function SyncStatus({ className = "" }: { className?: string }) {
  const { online, pending } = useSyncState();
  if (online && !pending) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-9 items-center gap-2 rounded-xl bg-track-2 px-3 py-1.5 font-mono text-xs text-body-2 ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${online ? "animate-pulse bg-fuel" : "bg-muted"}`}
      />
      {online ? "Saved on this device · syncing…" : "Offline · your entries are saved and will sync."}
    </div>
  );
}
