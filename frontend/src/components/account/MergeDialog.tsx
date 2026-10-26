"use client";

import { useState } from "react";
import { apiErrorMessage } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { linkErrorMessage } from "@/lib/auth/linking";
import { useOnline } from "@/lib/hooks/status";
import { Dialog, dangerBtn, primaryBtn, secondaryBtn, textBtn } from "./Dialog";

/** §5.5: the Google account / email already has Calgy data. */
export function MergeDialog() {
  const { conflict, resolveConflict } = useAuth();
  const online = useOnline();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!conflict) return null;

  const run = async (choice: "merge" | "discard" | "cancel") => {
    setBusy(true);
    setErr(null);
    try {
      await resolveConflict(choice);
      setConfirmDiscard(false);
    } catch (e) {
      setErr((e as { name?: string }).name === "ApiError" ? apiErrorMessage(e) : linkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="This account already has Calgy data." onCancel={busy ? undefined : () => run("cancel")}>
      {confirmDiscard ? (
        <>
          <span className="text-[15px] leading-[1.45] text-body-2">Data on this device will be deleted.</span>
          <button type="button" disabled={busy || !online} onClick={() => run("discard")} className={dangerBtn}>
            Delete it and use that account
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmDiscard(false)} className={textBtn}>
            Back
          </button>
        </>
      ) : (
        <>
          <span className="text-[15px] leading-[1.45] text-body-2">
            {conflict.email ? `${conflict.email} is` : "That Google account is"} already saved with Calgy. What should happen to
            the entries on this device?
          </span>
          <button type="button" disabled={busy || !online} onClick={() => run("merge")} className={primaryBtn}>
            {busy ? "Working…" : "Merge my current data into it"}
          </button>
          <button type="button" disabled={busy || !online} onClick={() => setConfirmDiscard(true)} className={secondaryBtn}>
            Use that account&apos;s data only
          </button>
          <button type="button" disabled={busy} onClick={() => run("cancel")} className={textBtn}>
            Cancel
          </button>
        </>
      )}
      {(!online || err) && <span className="font-mono text-xs text-red">{!online ? "Needs a connection." : err}</span>}
    </Dialog>
  );
}
