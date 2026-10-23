"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSolar, loadSpend, saveSolar, saveSpend } from "@/lib/db";
import { commas, digits, naira, num, todayIso, trim, uid } from "@/lib/format";
import { normaliseSolar } from "@/lib/solar";
import { cleanImported, DEFAULT_SETTINGS, makeSample, unitPrice, type Entry, type EntryType, type Settings } from "@/lib/spend";
import { Toast, useEscape, useToast } from "../ui";
import { Dashboard } from "./Dashboard";
import { LogSheet, type SheetState } from "./LogSheet";
import { Onboarding, Reveal, type ObState } from "./Onboarding";
import { SettingsView } from "./SettingsView";

type View = "onboard" | "reveal" | "home" | "settings";
type Data = { entries: Entry[]; settings: Settings };

const DEMO_SETTINGS: Settings = { ...DEFAULT_SETTINGS, onboarded: true, fuelWeekly: 25000, tokenMonthly: 40000 };

/**
 * Spend tracker: onboarding, dashboard, log sheet, settings.
 * `demo` runs on in-memory sample data and never touches storage (used on the landing page).
 */
export function SpendApp({ demo = false }: { demo?: boolean }) {
  const [data, setData] = useState<Data | null>(null);

  // Load on the client only: storage, dates and randomness can't run during prerender.
  useEffect(() => {
    let live = true;
    const load = demo ? Promise.resolve({ entries: makeSample(), settings: DEMO_SETTINGS }) : loadSpend();
    load.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [demo]);

  if (!data) return <div className="min-h-screen bg-paper" />;
  return <SpendView initial={data} demo={demo} />;
}

const obFrom = (s: Settings): ObState => ({
  fuel: s.fuelWeekly ? commas(s.fuelWeekly) : "",
  token: s.tokenMonthly ? commas(s.tokenMonthly) : "",
  hours: s.gridHours ?? 8,
});

const offsetFor = (dateStr: string) => {
  const [y, m] = dateStr.split("-").map(Number);
  const n = new Date();
  return Math.min(0, (y - n.getFullYear()) * 12 + (m - 1) - n.getMonth());
};

function SpendView({ initial, demo }: { initial: Data; demo: boolean }) {
  const [entries, setEntries] = useState(initial.entries);
  const [settings, setSettings] = useState(initial.settings);
  const [view, setView] = useState<View>(initial.settings.onboarded ? "home" : "onboard");
  const [offset, setOffset] = useState(0);
  const [ob, setOb] = useState<ObState>(() => obFrom(initial.settings));
  const [sheet, setSheetState] = useState<SheetState>({
    shown: false, mode: "new", id: null, type: "fuel", amount: "", qty: "", date: todayIso(), note: "",
  });
  const amountRef = useRef<HTMLInputElement>(null);
  const { toast, shown: toastShown, show: showToast } = useToast(2800);

  useEffect(() => {
    if (!demo) saveSpend(entries, settings);
  }, [entries, settings, demo]);

  const setSheet = (p: Partial<SheetState>) => setSheetState((s) => ({ ...s, ...p }));

  const openSheet = (type: EntryType, entry?: Entry) => {
    setSheetState(
      entry
        ? {
            shown: true, mode: "edit", id: entry.id, type: entry.type, amount: commas(entry.amount_naira),
            qty: entry.quantity != null ? String(entry.quantity) : "", date: entry.date, note: entry.note || "",
          }
        : { shown: true, mode: "new", id: null, type, amount: "", qty: "", date: todayIso(), note: "" },
    );
    // Focus synchronously inside the tap so mobile keyboards open.
    if (!entry) amountRef.current?.focus({ preventScroll: true });
  };

  const closeSheet = useCallback(() => {
    amountRef.current?.blur();
    setSheetState((s) => ({ ...s, shown: false }));
  }, []);
  useEscape(sheet.shown, closeSheet);

  const saveEntry = () => {
    const amt = num(digits(sheet.amount));
    if (!amt) return;
    const q = num(sheet.qty) || null;
    const date = sheet.date || todayIso();
    const old = sheet.id ? entries.find((e) => e.id === sheet.id) : undefined;
    const rec: Entry = {
      id: sheet.id || uid(), type: sheet.type, amount_naira: amt, quantity: q, unit_price: unitPrice(amt, q),
      date, note: sheet.note.trim() || null, created_at: old ? old.created_at : new Date().toISOString(),
    };
    setEntries((es) => (old ? es.map((e) => (e.id === rec.id ? rec : e)) : [rec, ...es]));
    setOffset(offsetFor(date));
    closeSheet();
    const label = rec.type === "fuel" ? "Fuel" : "Token";
    const extra = q
      ? rec.type === "fuel"
        ? ` · ₦${Math.round(amt / q).toLocaleString("en-NG")}/L`
        : ` · ₦${trim((amt / q).toFixed(1))}/kWh`
      : "";
    showToast(`${label} ${old ? "updated" : "logged"} · ${naira(amt)}${extra}`);
  };

  const deleteEntry = () => {
    const gone = entries.find((e) => e.id === sheet.id);
    if (!gone) return;
    setEntries((es) => es.filter((e) => e.id !== gone.id));
    closeSheet();
    showToast(`Deleted ${gone.type === "fuel" ? "fuel" : "token"} · ${naira(gone.amount_naira)}`, "Undo", () => {
      setEntries((es) => [gone, ...es]);
      showToast("Restored");
    });
  };

  const exportJson = async () => {
    const S = { ...settings, lastExport: new Date().toISOString() };
    const solarSettings = demo ? undefined : await loadSolar();
    const payload = { app: "calgy", version: 1, exported_at: S.lastExport, entries, settings: S, solarSettings };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `calgy-backup-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setSettings(S);
    showToast(`Backup downloaded · ${entries.length} entries`);
  };

  const importFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(String(r.result));
        if (!d || !Array.isArray(d.entries)) throw new Error("bad");
        const clean = cleanImported(d.entries);
        setEntries(clean);
        setOffset(0);
        setSettings((s) => ({ ...DEFAULT_SETTINGS, ...(d.settings || {}), onboarded: true, lastExport: s.lastExport }));
        if (!demo && d.solarSettings && typeof d.solarSettings === "object") saveSolar(normaliseSolar(d.solarSettings));
        showToast(`Imported ${clean.length} entries`);
      } catch {
        showToast("That file isn't a Calgy backup");
      }
    };
    r.readAsText(f);
  };

  const loadSample = (toHome: boolean) => {
    setEntries(makeSample());
    setOffset(0);
    if (toHome) {
      setSettings((s) => ({ ...s, onboarded: true }));
      setView("home");
    }
  };

  const obF = num(digits(ob.fuel));
  const obT = num(digits(ob.token));
  const obMonthly = (obF * 52) / 12 + obT;
  const saveOb = (extra: Partial<Settings> = {}) =>
    setSettings((s) => ({ ...s, fuelWeekly: obF, tokenMonthly: obT, gridHours: ob.hours, ...extra }));

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className="mx-auto flex min-h-screen max-w-[480px] flex-col px-5">
        {view === "onboard" && (
          <Onboarding
            ob={ob}
            setOb={setOb}
            onSkip={() => {
              setSettings((s) => ({ ...s, onboarded: true }));
              setView("home");
            }}
            onSeeEstimate={() => {
              if (obMonthly) {
                saveOb();
                setView("reveal");
              } else {
                saveOb({ onboarded: true });
                setView("home");
              }
            }}
          />
        )}
        {view === "reveal" && (
          <Reveal
            ob={ob}
            onStart={() => {
              setSettings((s) => ({ ...s, onboarded: true }));
              setOffset(0);
              setView("home");
            }}
            onAdjust={() => setView("onboard")}
          />
        )}
        {view === "home" && (
          <Dashboard
            entries={entries}
            settings={settings}
            offset={offset}
            setOffset={setOffset}
            onAdd={(t) => openSheet(t)}
            onEdit={(e) => openSheet(e.type, e)}
            onSettings={() => setView("settings")}
            onLoadSample={() => {
              loadSample(false);
              showToast("Sample data loaded — erase it in Settings");
            }}
          />
        )}
        {view === "settings" && (
          <SettingsView
            entryCount={entries.length}
            settings={settings}
            onBack={() => setView("home")}
            onRedo={() => {
              setOb(obFrom(settings));
              setView("onboard");
            }}
            onHours={(d) => setSettings((s) => ({ ...s, gridHours: Math.min(24, Math.max(0, s.gridHours + d)) }))}
            onExport={exportJson}
            onImport={importFile}
            onSample={() => {
              loadSample(true);
              showToast("Sample data loaded");
            }}
            onErase={() => {
              setEntries([]);
              setSettings({ ...DEFAULT_SETTINGS });
              setOb({ fuel: "", token: "", hours: 8 });
              setOffset(0);
              setView("onboard");
              showToast("All data erased");
            }}
          />
        )}
      </div>

      <LogSheet
        sheet={sheet}
        setSheet={setSheet}
        entries={entries}
        amountRef={amountRef}
        onClose={closeSheet}
        onSave={saveEntry}
        onDelete={deleteEntry}
      />

      <Toast toast={toast} shown={toastShown} bottom={view === "home" && !sheet.shown ? 108 : 24} />
    </div>
  );
}
