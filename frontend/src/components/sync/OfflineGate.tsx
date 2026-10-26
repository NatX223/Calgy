"use client";

import type { ReactNode } from "react";
import { useOnline } from "@/lib/hooks/status";

/** Controls that need the server: disabled offline with "Needs a connection." */
export function OfflineGate({ children, className = "" }: { children: ReactNode; className?: string }) {
  const online = useOnline();
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <fieldset disabled={!online} aria-describedby={online ? undefined : "offline-gate-note"} className="contents">
        <div className={online ? "contents" : "pointer-events-none opacity-45"}>{children}</div>
      </fieldset>
      {!online && (
        <span id="offline-gate-note" className="font-mono text-xs text-muted">
          Needs a connection.
        </span>
      )}
    </div>
  );
}
