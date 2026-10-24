"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { derivedTariff } from "@/lib/appliances";
import { loadDraft, loadGen, loadHome, loadSolar, loadSpend, saveDraft, saveGen, saveSolar, saveSpend } from "@/lib/db";
import { commas, digits, naira, num, todayIso, trim, uid } from "@/lib/format";
import {
  cleanImportedGen, GEN_ID, genSummary, naira10, OB_FUEL_ID, resolveKw,
  type FuelPurchase, type GeneratorProfile,
} from "@/lib/generator";
import { normaliseSolar } from "@/lib/solar";
import {
  byNewest, cleanImported, DEFAULT_SETTINGS, makeSample, OB_TOPUP_ID, unitPrice,
  type Entry, type EntryType, type Settings,
} from "@/lib/spend";
import { Logo, Toast, useEscape, useToast } from "../ui";
import { Dashboard } from "./Dashboard";
import { draftSize, GenReport, GenSteps, stepError, type GenDraft, type GenStep } from "./GenOnboarding";
import { Insights } from "./Insights";
import { LogSheet, type SheetState } from "./LogSheet";
import { obMonthly, Onboarding, Reveal, usesGen, usesGrid, type ObState } from "./Onboarding";
import { SettingsView } from "./SettingsView";

type View = "onboard" | "gen" | "reveal" | "genReveal" | "genView" | "home" | "insights" | "settings";
type Draft = { view: View; ob: ObState; gen: GenDraft };
type Data = {
  entries: Entry[];
  settings: Settings;
  generator: GeneratorProfile | null;
  purchases: FuelPurchase[];
  draft: Draft | null;
  tariffOverride: number | null;
};

const DRAFT_KEY = "onboarding";
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
    const load: Promise<Data> = demo
      ? Promise.resolve({
          entries: makeSample(), settings: DEMO_SETTINGS, generator: null, purchases: [], draft: null, tariffOverride: null,
        })
      : Promise.all([loadSpend(), loadGen(), loadDraft<Draft>(DRAFT_KEY), loadHome()]).then(([spend, gen, draft, home]) => ({
          ...spend, ...gen, draft, tariffOverride: home.tariffOverride,
        }));
    load.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [demo]);

  if (!data) return <div className="min-h-screen bg-paper" />;
  return <SpendView initial={data} demo={demo} />;
}

const obFrom = (s: Settings, entries: Entry[]): ObState => {
  const topup = entries.find((e) => e.id === OB_TOPUP_ID);
  return {
    source: s.source ?? "nepa",
    fuel: s.fuelWeekly ? commas(s.fuelWeekly) : "",
    dailyKwh: s.dailyKwh ? String(s.dailyKwh) : "",
    unitsLeft: s.unitsLeft ? String(s.unitsLeft) : "",
    topupDate: topup?.date ?? todayIso(),
    topupPrice: topup ? commas(topup.amount_naira) : "",
    topupUnits: topup?.quantity != null ? String(topup.quantity) : "",
    hours: s.gridHours ?? 8,
  };
};

/** Gen answers from the saved profile, or a fresh start offering the latest logged fuel as the first purchase. */
const genFrom = (gen: GeneratorProfile | null, purchases: FuelPurchase[], entries: Entry[]): GenDraft => {
  const ob = purchases.find((p) => p.source === "onboarding");
  const latest = ob ? undefined : entries.filter((e) => e.type === "fuel").sort(byNewest)[0];
  return {
    step: 1,
    sizeSource: gen?.sizeSource ?? null,
    typeId: gen?.typeId ?? "",
    rating: gen?.ratingValue ? String(gen.ratingValue) : "",
    unit: gen?.ratingUnit ?? "kVA",
    fuelType: gen?.fuelType ?? "petrol",
    amount: ob ? commas(ob.amountNaira) : "",
    date: ob?.purchasedAt ?? todayIso(),
    litres: ob ? String(ob.litres) : "",
    hours: ob?.hoursRun ? String(ob.hoursRun) : "",
    entryId: ob?.id ?? OB_FUEL_ID,
    prefill: latest ? { id: latest.id, amount: latest.amount_naira, litres: latest.quantity, date: latest.date } : null,
    prefillUsed: null,
  };
};

const offsetFor = (dateStr: string) => {
  const [y, m] = dateStr.split("-").map(Number);
  const n = new Date();
  return Math.min(0, (y - n.getFullYear()) * 12 + (m - 1) - n.getMonth());
};

function SpendView({ initial, demo }: { initial: Data; demo: boolean }) {
  const resume = !initial.settings.onboarded ? initial.draft : null;
  const [entries, setEntries] = useState(initial.entries);
  const [settings, setSettings] = useState(initial.settings);
  const [generator, setGenerator] = useState(initial.generator);
  const [purchases, setPurchases] = useState(initial.purchases);
  const [view, setView] = useState<View>(resume?.view ?? (initial.settings.onboarded ? "home" : "onboard"));
  const [offset, setOffset] = useState(0);
  const [ob, setOb] = useState<ObState>(() => resume?.ob ?? obFrom(initial.settings, initial.entries));
  const [genDraft, setGenDraft] = useState<GenDraft>(
    () => resume?.gen ?? genFrom(initial.generator, initial.purchases, initial.entries),
  );
  /** Set while editing only the gen size; the view to return to. */
  const [sizeReturn, setSizeReturn] = useState<View | null>(null);
  const [sheet, setSheetState] = useState<SheetState>({
    shown: false, mode: "new", id: null, type: "fuel", amount: "", qty: "", hours: "", date: todayIso(), note: "",
  });
  const amountRef = useRef<HTMLInputElement>(null);
  const { toast, shown: toastShown, show: showToast } = useToast(2800);

  useEffect(() => {
    if (!demo) saveSpend(entries, settings);
  }, [entries, settings, demo]);

  useEffect(() => {
    if (!demo) saveGen(generator, purchases);
  }, [generator, purchases, demo]);

  // Keep half-finished first-run answers so leaving mid-flow resumes at the same step.
  useEffect(() => {
    if (demo) return;
    const mid = !settings.onboarded && (view === "onboard" || view === "gen");
    saveDraft<Draft>(DRAFT_KEY, mid ? { view, ob, gen: genDraft } : null);
  }, [demo, view, ob, genDraft, settings.onboarded]);

  const setSheet = (p: Partial<SheetState>) => setSheetState((s) => ({ ...s, ...p }));

  const openSheet = (type: EntryType, entry?: Entry) => {
    const hrs = entry && purchases.find((p) => p.id === entry.id)?.hoursRun;
    setSheetState(
      entry
        ? {
            shown: true, mode: "edit", id: entry.id, type: entry.type, amount: commas(entry.amount_naira),
            qty: entry.quantity != null ? String(entry.quantity) : "", hours: hrs ? String(hrs) : "",
            date: entry.date, note: entry.note || "",
          }
        : { shown: true, mode: "new", id: null, type, amount: "", qty: "", hours: "", date: todayIso(), note: "" },
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
    // Fuel with litres feeds the gen numbers; anything else drops out of them.
    if (generator) {
      setPurchases((ps) => {
        const prev = ps.find((p) => p.id === rec.id);
        const rest = ps.filter((p) => p.id !== rec.id);
        if (rec.type !== "fuel" || !q) return rest;
        return [
          ...rest,
          {
            id: rec.id, generatorId: generator.id, amountNaira: amt, litres: q, hoursRun: num(sheet.hours) || null,
            purchasedAt: date, source: prev?.source ?? "log", createdAt: prev?.createdAt ?? rec.created_at,
          },
        ];
      });
    }
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
    const gonePurchase = purchases.find((p) => p.id === gone.id);
    setEntries((es) => es.filter((e) => e.id !== gone.id));
    setPurchases((ps) => ps.filter((p) => p.id !== gone.id));
    closeSheet();
    showToast(`Deleted ${gone.type === "fuel" ? "fuel" : "token"} · ${naira(gone.amount_naira)}`, "Undo", () => {
      setEntries((es) => [gone, ...es]);
      if (gonePurchase) setPurchases((ps) => [...ps, gonePurchase]);
      showToast("Restored");
    });
  };

  const exportJson = async () => {
    const S = { ...settings, lastExport: new Date().toISOString() };
    const solarSettings = demo ? undefined : await loadSolar();
    const payload = {
      app: "calgy", version: 1, exported_at: S.lastExport, entries, settings: S, solarSettings,
      generator, fuelPurchases: purchases,
    };
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
        const fuelIds = new Set(clean.filter((e) => e.type === "fuel").map((e) => e.id));
        const gen = cleanImportedGen(d.generator, d.fuelPurchases, fuelIds);
        setEntries(clean);
        setGenerator(gen.generator);
        setPurchases(gen.purchases);
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
    setPurchases([]); // sample entries are all new, so no purchase matches them
    setOffset(0);
    if (toHome) {
      setSettings((s) => ({ ...s, onboarded: true }));
      setView("home");
    }
  };

  const obEstimate = obMonthly(ob).monthly;
  const saveOb = (extra: Partial<Settings> = {}) => {
    const grid = usesGrid(ob.source);
    setSettings((s) => ({
      ...s,
      source: ob.source,
      fuelWeekly: num(digits(ob.fuel)),
      tokenMonthly: Math.round(obMonthly(ob).tokenM),
      gridHours: ob.hours,
      dailyKwh: grid ? num(ob.dailyKwh) : 0,
      unitsLeft: grid ? num(ob.unitsLeft) : 0,
      unitsAsOf: grid && num(ob.unitsLeft) ? todayIso() : null,
      ...extra,
    }));
    // The last top-up doubles as the first token log; a fixed id keeps redoing onboarding from duplicating it.
    const amt = num(digits(ob.topupPrice));
    const q = num(ob.topupUnits) || null;
    setEntries((es) => {
      const rest = es.filter((e) => e.id !== OB_TOPUP_ID);
      if (!grid || !amt) return rest;
      const old = es.find((e) => e.id === OB_TOPUP_ID);
      const rec: Entry = {
        id: OB_TOPUP_ID, type: "token", amount_naira: amt, quantity: q, unit_price: unitPrice(amt, q),
        date: ob.topupDate || todayIso(), note: null, created_at: old?.created_at ?? new Date().toISOString(),
      };
      return [rec, ...rest];
    });
  };

  const goStep = (step: GenStep) => {
    setGenDraft((g) => ({ ...g, step }));
    window.scrollTo(0, 0);
  };

  const editGenSize = (from: View) => {
    setGenDraft({ ...genFrom(generator, purchases, entries), step: 1 });
    setSizeReturn(from);
    setView("gen");
  };

  const leaveSizeEdit = () => {
    setView(sizeReturn ?? "home");
    setSizeReturn(null);
  };

  /** Save the gen profile and, unless only the size changed, the purchase it was costed from. */
  const finishGen = () => {
    const g = genDraft;
    const now = new Date().toISOString();
    const size = draftSize(g);
    setGenerator({ id: GEN_ID, ...size, ...resolveKw(size), fuelType: g.fuelType, createdAt: generator?.createdAt ?? now });
    if (sizeReturn) {
      leaveSizeEdit();
      showToast("Gen size updated");
      return;
    }
    // The purchase is also a fuel entry in the spend log: either one the user already logged, or a new one.
    const id = g.entryId;
    const amt = num(digits(g.amount));
    const litres = num(g.litres);
    setEntries((es) => {
      const old = es.find((e) => e.id === id);
      const rec: Entry = {
        id, type: "fuel", amount_naira: amt, quantity: litres, unit_price: unitPrice(amt, litres), date: g.date,
        note: old?.note ?? null, created_at: old?.created_at ?? now,
      };
      return old ? es.map((e) => (e.id === id ? rec : e)) : [rec, ...es];
    });
    setPurchases((ps) => {
      const old = ps.find((p) => p.id === id);
      // Redoing onboarding with a different purchase keeps the old one as an ordinary log.
      const rest = ps.filter((p) => p.id !== id).map((p) => (p.source === "onboarding" ? { ...p, source: "log" as const } : p));
      return [
        ...rest,
        {
          id, generatorId: GEN_ID, amountNaira: amt, litres, hoursRun: num(g.hours), purchasedAt: g.date,
          source: "onboarding", createdAt: old?.createdAt ?? now,
        },
      ];
    });
    setSettings((s) => ({ ...s, onboarded: true }));
    setView("genReveal");
    window.scrollTo(0, 0);
  };

  const genBack = () => {
    const g = genDraft;
    if (sizeReturn) {
      setGenDraft(genFrom(generator, purchases, entries));
      leaveSizeEdit();
    } else if (g.step === 1) setView("onboard");
    else if (g.step === 2 && g.prefill && g.prefillUsed === false) setGenDraft((s) => ({ ...s, prefillUsed: null }));
    else if (g.step === 4 && g.prefillUsed && g.prefill?.litres) goStep(2);
    else goStep((g.step - 1) as GenStep);
  };

  const genNext = () => {
    if (stepError(genDraft, genDraft.step) !== null) return;
    if (sizeReturn || genDraft.step === 4) finishGen();
    else goStep((genDraft.step + 1) as GenStep);
  };

  const summary = generator ? genSummary(generator, purchases) : null;
  const meterTariff = initial.tariffOverride ?? derivedTariff(entries)?.value ?? null;
  const genLine = summary
    ? `${summary.nairaPerHour != null ? `~${naira10(summary.nairaPerHour)}/hr · ` : ""}${naira10(summary.perKwhLow)}–${naira10(summary.perKwhHigh)}/unit`
    : undefined;

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
              if (usesGen(ob.source)) {
                saveOb();
                setView("gen");
                window.scrollTo(0, 0);
              } else if (obEstimate) {
                saveOb();
                setView("reveal");
              } else {
                saveOb({ onboarded: true });
                setView("home");
              }
            }}
          />
        )}
        {view === "gen" && (
          <GenSteps g={genDraft} setG={setGenDraft} sizeOnly={sizeReturn != null} onBack={genBack} onNext={genNext} />
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
        {view === "genReveal" && generator && summary && (
          <GenReport
            gen={generator}
            summary={summary}
            meterTariff={meterTariff}
            header={
              <header className="flex h-16 items-center">
                <Logo />
              </header>
            }
            onUpdateSize={() => editGenSize("genReveal")}
          >
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setOffset(0);
                  setView("home");
                }}
                className="h-[58px] rounded-2xl bg-ink text-[17px] font-bold text-card active:scale-[.98]"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => {
                  setOffset(0);
                  setView("home");
                  openSheet("fuel");
                }}
                className="h-12 text-[15px] font-medium text-muted"
              >
                Log another purchase
              </button>
            </div>
          </GenReport>
        )}
        {view === "genView" && generator && summary && (
          <GenReport
            gen={generator}
            summary={summary}
            meterTariff={meterTariff}
            header={
              <header className="flex h-16 items-center">
                <button type="button" onClick={() => setView("home")} className="h-11 pr-3 text-base font-semibold">
                  ‹ Back
                </button>
              </header>
            }
            onUpdateSize={() => editGenSize("genView")}
          >
            <button
              type="button"
              onClick={() => openSheet("fuel")}
              className="h-[58px] rounded-2xl bg-fuel text-[17px] font-extrabold text-ink active:scale-[.98]"
            >
              + Log fuel purchase
            </button>
          </GenReport>
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
            onInsights={() => setView("insights")}
            genLine={genLine}
            onGen={() => {
              setView("genView");
              window.scrollTo(0, 0);
            }}
            onLoadSample={() => {
              loadSample(false);
              showToast("Sample data loaded — erase it in Settings");
            }}
          />
        )}
        {view === "insights" && <Insights entries={entries} settings={settings} onBack={() => setView("home")} />}
        {view === "settings" && (
          <SettingsView
            entryCount={entries.length}
            settings={settings}
            genLine={genLine}
            onBack={() => setView("home")}
            onRedo={() => {
              setOb(obFrom(settings, entries));
              setGenDraft(genFrom(generator, purchases, entries));
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
              setGenerator(null);
              setPurchases([]);
              setOb(obFrom(DEFAULT_SETTINGS, []));
              setGenDraft(genFrom(null, [], []));
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
        showHours={generator != null}
        amountRef={amountRef}
        onClose={closeSheet}
        onSave={saveEntry}
        onDelete={deleteEntry}
      />

      <Toast toast={toast} shown={toastShown} bottom={view === "home" && !sheet.shown ? 108 : 24} />
    </div>
  );
}
