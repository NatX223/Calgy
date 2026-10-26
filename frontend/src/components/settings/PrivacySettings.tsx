"use client";

import { useRef, useState } from "react";
import { apiErrorMessage, isApiError } from "@/lib/api/types";
import { linkErrorMessage } from "@/lib/auth/linking";
import { useAuth } from "@/lib/auth/AuthProvider";
import { downloadExport, importExport, ImportFormatError } from "@/lib/data/export";
import { useUserDoc } from "@/lib/hooks/status";
import { notify } from "@/lib/notify";
import { Dialog, dangerBtn, textBtn } from "../account/Dialog";
import { OfflineGate } from "../sync/OfflineGate";
import { btn, btnDark, Card, SettingsPage, Toggle } from "./SettingsPage";

const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 864e5);

/** §12 Help improve Calgy + Estimates + Data & privacy (export, import, delete). */
export function PrivacySettings() {
  const { uid, deleteAccount } = useAuth();
  const { userDoc, update } = useUserDoc();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | "share" | "estimates" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const s = userDoc?.settings;
  // Only once the doc has loaded (never during prerender, where the time isn't stable).
  const daysSince = s?.lastExport ? daysAgo(s.lastExport) : null;

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string | void>) => {
    setBusy(kind);
    setMsg(null);
    try {
      const m = await fn();
      if (m) notify(m);
    } catch (e) {
      setMsg(e instanceof ImportFormatError ? e.message : apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsPage title="Data & privacy">
      <OfflineGate>
        <Card>
          <Toggle
            label="Help improve Calgy"
            hint="Share anonymous numbers (like fuel used per hour and price per unit) to make estimates better for everyone. No names, no exact dates, never sold."
            checked={!!s?.shareAnonymousData}
            disabled={!s || busy === "share"}
            onChange={(on) => run("share", () => update({ settings: { shareAnonymousData: on } }).then(() => {}))}
          />
        </Card>
        <Card>
          <Toggle
            label="Match estimates to my meter and fuel"
            hint="Adjusts device estimates so they add up to what your meter and fuel logs show."
            checked={!!s?.calibrationEnabled}
            disabled={!s || busy === "estimates"}
            onChange={(on) => run("estimates", () => update({ settings: { calibrationEnabled: on } }).then(() => {}))}
          />
        </Card>
      </OfflineGate>

      <Card className="flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted">Export &amp; import</span>
          <span className="font-mono text-xs text-muted">
            {daysSince === null ? "No export yet" : daysSince === 0 ? "Exported today" : `Last: ${daysSince}d ago`}
          </span>
        </div>
        <span className="text-[15px] leading-[1.45] text-pretty">
          Download everything as a JSON file, or bring entries in from one. Importing adds entries you don&apos;t already have.
        </span>
        <OfflineGate>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={!uid || !!busy}
              onClick={() => run("export", async () => `Exported · ${await downloadExport(uid!)} items`)}
              className={btnDark}
            >
              {busy === "export" ? "Exporting…" : "Export JSON"}
            </button>
            <button type="button" disabled={!uid || !!busy} onClick={() => fileRef.current?.click()} className={btn}>
              {busy === "import" ? "Importing…" : "Import JSON"}
            </button>
          </div>
        </OfflineGate>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && uid)
              void run("import", async () => {
                const { imported, skipped } = await importExport(uid, await f.text());
                return `Imported ${imported} · skipped ${skipped} already here`;
              });
          }}
        />
        {msg && <span className="font-mono text-xs text-red">{msg}</span>}
      </Card>

      <Card>
        <span className="text-base font-semibold">Delete my data</span>
        <span className="text-[15px] leading-[1.45] text-body-2">
          Deletes your entries, devices and settings from this device and from your account. This can&apos;t be undone.
        </span>
        <OfflineGate>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="h-12 rounded-xl border-[1.5px] border-red text-[15px] font-semibold text-red"
          >
            Delete my data
          </button>
        </OfflineGate>
      </Card>

      {confirmDelete && <DeleteDialog onCancel={() => setConfirmDelete(false)} onDelete={deleteAccount} />}
    </SettingsPage>
  );
}

function DeleteDialog({ onCancel, onDelete }: { onCancel: () => void; onDelete: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog title="Delete all your Calgy data?" onCancel={busy ? undefined : onCancel}>
      <span className="text-[15px] leading-[1.45] text-body-2">
        Type <b>DELETE</b> to confirm. Your entries, devices and settings will be gone for good.
      </span>
      <input
        aria-label="Type DELETE to confirm"
        value={typed}
        autoCapitalize="characters"
        autoComplete="off"
        onChange={(e) => setTyped(e.target.value)}
        className="h-[50px] rounded-xl border-[1.5px] border-line bg-paper px-3 font-mono text-[17px] outline-none"
      />
      <button
        type="button"
        disabled={typed.trim() !== "DELETE" || busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await onDelete();
          } catch (e) {
            setErr(isApiError(e) ? apiErrorMessage(e) : linkErrorMessage(e));
            setBusy(false);
          }
        }}
        className={dangerBtn}
      >
        {busy ? "Deleting…" : "Delete my data"}
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className={textBtn}>
        Cancel
      </button>
      {err && <span className="font-mono text-xs text-red">{err}</span>}
    </Dialog>
  );
}
