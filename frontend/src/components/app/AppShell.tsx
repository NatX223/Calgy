"use client";

import { Fragment, useEffect, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import { onNotify } from "@/lib/notify";
import { registerServiceWorker } from "@/lib/push/push";
import { MergeDialog } from "../account/MergeDialog";
import { MigrationDialog } from "../account/MigrationDialog";
import { Logo, Toast, useToast } from "../ui";

/** Everything under /app and /auth: auth bootstrap, account dialogs, app-wide toasts. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider renderMigrationDialog={(answer) => <MigrationDialog onAnswer={answer} />}>
      <AppGate>{children}</AppGate>
      <MergeDialog />
      <GlobalToast />
    </AuthProvider>
  );
}

/**
 * Full-screen loader only until auth resolves (and a one-time migration runs); never on network after that.
 * The screens still render underneath (they wait for the user themselves), so routes keep a static shell.
 */
function AppGate({ children }: { children: ReactNode }) {
  const { user, status, error, waitingForNetwork, retrySession, epoch } = useAuth();

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true") void registerServiceWorker();
  }, []);

  const loading = !user || status === "loading";
  return (
    <>
      {loading && (
        <div className="fixed inset-0 z-[85] flex flex-col items-center justify-center gap-4 bg-paper px-5 text-center">
          <Logo size={32} />
          {status === "error" ? (
            <>
              <span className="max-w-[340px] text-[15px] leading-[1.45] text-body-2">{error}</span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="h-11 rounded-xl border-[1.5px] border-line-strong px-4 text-sm font-semibold"
              >
                Try again
              </button>
            </>
          ) : (
            <span className="font-mono text-xs text-muted" aria-live="polite">
              {waitingForNetwork ? "Connect to the internet to set up Calgy." : "Loading…"}
            </span>
          )}
        </div>
      )}
      {!loading && status === "error" && (
        <div role="alert" className="sticky top-0 z-[70] flex items-center justify-center gap-3 bg-red-soft px-5 py-2 text-sm">
          <span>{error ?? "Something went wrong."}</span>
          <button type="button" onClick={retrySession} className="h-9 rounded-lg bg-ink px-3 text-sm font-semibold text-card">
            Try again
          </button>
        </div>
      )}
      {/* An account switch (merge) remounts the screens so they load the new account's data. */}
      <Fragment key={epoch}>{children}</Fragment>
    </>
  );
}

function GlobalToast() {
  const { toast, shown, show } = useToast(3200);
  useEffect(() => onNotify((n) => show(n.msg, n.actionLabel, n.action)), [show]);
  return <Toast toast={toast} shown={shown} bottom={24} />;
}
