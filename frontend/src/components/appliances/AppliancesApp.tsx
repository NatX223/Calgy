"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  derivedTariff, draftFrom, draftToDevice, initSim, isModified, lagosFlat, newCustomDraft, newDraft, toDevice,
  type Device, type Draft, type SimRow, type Tariff,
} from "@calgy/engine/appliances";
import { sumSplits } from "@calgy/engine/calibration";
import { loadGen, loadHome, loadMeter, loadSpend, patchSettings, saveHome, saveMeter } from "@/lib/data/store";
import { fU } from "@calgy/engine/format";
import type { FuelPurchase, GeneratorProfile } from "@calgy/engine/generator";
import { calibContext, calibrateHome, homeSplits, inferredHoursPatch, simFuel, splitsOf, unitsOf } from "@calgy/engine/home-calibration";
import type { MeterReading, MeterState } from "@calgy/engine/meter";
import type { Preset } from "@calgy/engine/presets";
import type { Entry, Settings } from "@calgy/engine/spend";
import { Logo, Toast, useEscape, useToast } from "../ui";
import { DeviceEditor } from "./DeviceEditor";
import { MyHome } from "./MyHome";
import { Picker } from "./Picker";
import { Simulator, type SimUi } from "./Simulator";
import { TariffSheet } from "./TariffSheet";

type Data = {
  devices: Device[];
  tariffOverride: number | null;
  entries: Entry[];
  settings: Settings;
  readings: MeterReading[];
  meter: MeterState;
  generator: GeneratorProfile | null;
  purchases: FuelPurchase[];
};

/**
 * My Home inventory + Simulator. Mounted from a shared layout so the simulator's
 * scratch copy survives switching between /app/home and /app/simulator.
 */
export function AppliancesApp() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([loadHome(), loadSpend(), loadMeter(), loadGen()]).then(([home, spend, meter, gen]) => {
      if (live)
        setData({
          devices: home.devices,
          tariffOverride: home.tariffOverride,
          entries: spend.entries,
          settings: spend.settings,
          ...meter,
          ...gen,
        });
    });
    return () => {
      live = false;
    };
  }, []);

  if (!data) return <div className="min-h-screen bg-paper" />;
  return <AppliancesView initial={data} />;
}

type SheetKind = "picker" | "editor" | "tariff";

function AppliancesView({ initial }: { initial: Data }) {
  const view = usePathname() === "/app/simulator" ? "sim" : "home";
  const router = useRouter();

  const [devices, setDevices] = useState(initial.devices);
  const [tariffOverride, setTariffOverride] = useState(initial.tariffOverride);
  const [settings, setSettings] = useState(initial.settings);
  const [meter, setMeter] = useState(initial.meter);
  const { entries, readings, generator, purchases } = initial;
  const [sim, setSim] = useState<SimRow[] | null>(null);
  const [simUi, setSimUiState] = useState<SimUi>({
    period: "month", customDays: "14", sort: "cost", expanded: null, tokenAmt: "10,000", mode: null, simG: null, simH: null,
    fuelAmt: "10",
  });
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [sheetShown, setSheetShown] = useState(false);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [pickTarget, setPickTarget] = useState<"home" | "sim">("home");
  const [pick, setPick] = useState({ q: "", cat: "all" });
  const [openCount, setOpenCount] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const { toast, shown: toastShown, show: showToast } = useToast();

  useEffect(() => {
    saveHome(devices, tariffOverride);
  }, [devices, tariffOverride]);
  // Only the light-hours and calibration settings change here; the rest belong to the spend screens.
  useEffect(() => {
    const { gridHours, gridHoursSource, gridHoursRange, calibrate } = settings;
    patchSettings({ gridHours, gridHoursSource, gridHoursRange, calibrate });
  }, [settings]);
  useEffect(() => {
    saveMeter(readings, meter);
  }, [readings, meter]);
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  // Switching tabs (incl. browser back/forward) closes sheets and clears the "coming soon" explainer.
  const [prevView, setPrevView] = useState(view);
  if (prevView !== view) {
    setPrevView(view);
    setSheetShown(false);
    setConfirm(false);
  }

  const setSimUi = (p: Partial<SimUi>) => setSimUiState((s) => ({ ...s, ...p }));
  const setDraft = (p: Partial<Draft>) => setDraftState((d) => (d ? { ...d, ...p } : d));

  const derived = derivedTariff(entries);
  const T: Tariff | null = tariffOverride ? { value: tariffOverride, source: "Set by you" } : derived;

  // Calibration re-runs whenever My Home's devices change (incl. "Save as My Home"), never inside the simulator.
  const state = { settings, devices, entries, readings, meter, generator, purchases };
  const cal = useMemo(
    () => calibrateHome({ settings, devices, entries, readings, meter, generator, purchases }),
    [settings, devices, entries, readings, meter, generator, purchases],
  );
  const hoursPatch = inferredHoursPatch(settings, cal);
  if (hoursPatch) setSettings((s) => ({ ...s, ...hoursPatch }));
  const calib = calibContext(state, cal, T?.value ?? null);
  const fuel = simFuel(generator, purchases, entries);

  const rows = sim ?? initSim(devices);
  const homeTot = unitsOf(sumSplits(homeSplits(calib, devices))).typical;
  const simTot = unitsOf(
    sumSplits(splitsOf(calib, rows.filter((r) => r.on).map((r) => ({ device: toDevice(r), baseId: r.baseId })))),
  ).typical;
  const anyMod = rows.some((r) => isModified(r, devices)) || rows.length !== devices.length;

  const simEdit = (key: string, fn: (r: SimRow) => Partial<SimRow>) =>
    setSim((s) => (s ?? initSim(devices)).map((r) => (r.key === key ? { ...r, ...fn(r) } : r)));

  const openSheet = (kind: SheetKind) => {
    setSheet(kind);
    setSheetShown(true);
    setOpenCount((n) => n + 1);
  };
  const closeSheet = useCallback(() => setSheetShown(false), []);
  useEscape(sheetShown, closeSheet);
  useEscape(confirm, () => setConfirm(false));

  const flash = (id: string) => {
    window.clearTimeout(highlightTimer.current);
    setHighlight(id);
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 2200);
  };

  const openPicker = (target: "home" | "sim") => {
    setPickTarget(target);
    setPick({ q: "", cat: "all" });
    openSheet("picker");
  };

  const openEditor = (d: Device) => {
    setDraftState(draftFrom(d));
    openSheet("editor");
  };

  const pickPreset = (p: Preset) => {
    setDraftState(newDraft(p, pickTarget));
    setSheet("editor");
  };

  const pickCustom = (name: string) => {
    setDraftState(newCustomDraft(name, pickTarget));
    setSheet("editor");
  };

  const saveDraft = () => {
    if (!draft) return;
    const clean = draftToDevice(draft);
    if (draft.mode === "edit") {
      setDevices((ds) => ds.map((x) => (x.id === clean.id ? clean : x)));
      setSim(null);
      closeSheet();
      showToast(`${clean.name} updated`);
    } else if (draft.target === "sim") {
      const key = "s-" + clean.id;
      setSim((s) => [...(s ?? initSim(devices)), { ...clean, key, baseId: null, on: true }]);
      setSimUi({ expanded: key });
      closeSheet();
      showToast(`${clean.name} added to simulation`);
    } else {
      setDevices((ds) => [...ds, clean]);
      setSim(null);
      closeSheet();
      if (view !== "home") router.push("/app/home");
      flash(clean.id);
      showToast(`${clean.name} added to My Home`);
    }
  };

  const deleteDraft = () => {
    const idx = devices.findIndex((x) => x.id === draft?.id);
    if (idx < 0) return;
    const gone = devices[idx];
    setDevices((ds) => ds.filter((x) => x.id !== gone.id));
    setSim(null);
    closeSheet();
    showToast(`Removed ${gone.name}`, "Undo", () => {
      setDevices((ds) => {
        const arr = ds.slice();
        arr.splice(idx, 0, gone);
        return arr;
      });
      setSim(null);
      showToast("Restored");
    });
  };

  const loadLagos = () => {
    setDevices(lagosFlat());
    setSim(null);
    if (view !== "home") router.push("/app/home");
    setBanner("We added a typical setup. Tap any device to match your own.");
  };

  const confirmSave = () => {
    const next = rows.filter((r) => r.on).map((r) => ({ ...toDevice(r), id: r.baseId || r.id }));
    setDevices(next);
    setSim(null);
    setConfirm(false);
    setSimUi({ expanded: null });
    router.push("/app/home");
    showToast("Saved as My Home");
  };

  const offCount = rows.length - rows.filter((r) => r.on).length;
  const navItem = (active: boolean) =>
    `inline-flex h-10 items-center rounded-[10px] px-3 text-sm font-semibold text-ink no-underline ${
      active ? "bg-card shadow-[0_1px_2px_rgba(25,23,18,0.12)]" : ""
    }`;

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className={`mx-auto max-w-[600px] px-5 ${view === "sim" ? "wide:max-w-[1080px]" : ""}`}>
        <header className="flex h-[68px] items-center justify-between gap-3">
          <Logo />
          <nav className="flex gap-0.5 rounded-[13px] bg-track p-[3px]">
            <Link href="/app" className={navItem(false)}>
              Spend
            </Link>
            <Link href="/app/home" className={navItem(view === "home")} aria-current={view === "home" ? "page" : undefined}>
              My Home
            </Link>
            <Link href="/app/simulator" className={navItem(view === "sim")} aria-current={view === "sim" ? "page" : undefined}>
              Simulator
            </Link>
          </nav>
        </header>

        {view === "home" ? (
          <MyHome
            devices={devices}
            T={T}
            calib={calib}
            fuel={fuel}
            hoursSource={settings.gridHoursSource}
            keptAt={meter.suggestionKeptAt}
            onSetHours={(h) => {
              setSettings((s) => ({ ...s, gridHours: h, gridHoursSource: "user", gridHoursRange: null }));
              setMeter((m) => ({ ...m, suggestionKeptAt: null }));
              showToast(`Light hours set · ${h}h a day`);
            }}
            onKeepHours={() => setMeter((m) => ({ ...m, suggestionKeptAt: cal.grid?.confidence ?? "rough" }))}
            banner={banner}
            onDismissBanner={() => setBanner(null)}
            highlight={highlight}
            onOpen={openEditor}
            onAdd={() => openPicker("home")}
            onSim={() => router.push("/app/simulator")}
            onLagos={loadLagos}
            onTariff={() => openSheet("tariff")}
          />
        ) : (
          <Simulator
            home={devices}
            rows={rows}
            T={T}
            calib={calib}
            fuel={fuel}
            ui={simUi}
            setUi={setSimUi}
            simEdit={simEdit}
            removeRow={(key) => {
              setSim((s) => (s ?? initSim(devices)).filter((x) => x.key !== key));
              setSimUi({ expanded: null });
            }}
            anyMod={anyMod}
            onAdd={() => openPicker("sim")}
            onTariff={() => openSheet("tariff")}
            onGoHome={() => router.push("/app/home")}
            onLagos={loadLagos}
            onReset={() => {
              setSim(null);
              setSimUi({ expanded: null });
              showToast("Back to My Home");
            }}
            onAskSave={() => setConfirm(true)}
          />
        )}
      </div>

      {/* Sheet: bottom sheet on mobile, right side panel ≥900px */}
      <div
        onClick={closeSheet}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-[rgba(25,23,18,0.45)] transition-opacity duration-250 ${
          sheetShown ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        inert={!sheetShown}
        className={`ease-sheet fixed inset-x-0 bottom-0 z-50 flex flex-col justify-end transition-transform duration-320 wide:top-0 wide:left-auto wide:w-[460px] ${
          sheetShown
            ? "pointer-events-auto translate-y-0 wide:translate-x-0"
            : "pointer-events-none translate-y-[105%] wide:translate-x-[105%] wide:translate-y-0"
        }`}
      >
        <div className="mx-auto grid max-h-[92vh] w-full max-w-[560px] auto-rows-max grid-cols-1 content-start gap-4 overflow-y-auto rounded-t-[24px] bg-card px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(25,23,18,0.18)] wide:h-full wide:max-h-full wide:max-w-none wide:rounded-l-[24px] wide:rounded-tr-none">
          <div className="mx-auto h-1 w-10 rounded-sm bg-line wide:opacity-0" />
          {sheet === "picker" && (
            <Picker
              target={pickTarget}
              q={pick.q}
              cat={pick.cat}
              setPick={(p) => setPick((s) => ({ ...s, ...p }))}
              onClose={closeSheet}
              onPick={pickPreset}
              onCustom={pickCustom}
            />
          )}
          {sheet === "editor" && draft && (
            <DeviceEditor
              draft={draft}
              setDraft={setDraft}
              T={T}
              calib={calib}
              fuel={fuel}
              ctxTotal={draft.target === "sim" ? simTot : homeTot}
              home={devices}
              onBack={() => setSheet("picker")}
              onClose={closeSheet}
              onSave={saveDraft}
              onDelete={deleteDraft}
            />
          )}
          {sheet === "tariff" && (
            <TariffSheet
              key={openCount}
              derived={derived}
              tariffOverride={tariffOverride}
              onClose={closeSheet}
              onUseDerived={() => {
                setTariffOverride(null);
                closeSheet();
                showToast("Using your logged tokens");
              }}
              onSave={(v) => {
                setTariffOverride(Math.round(v * 100) / 100);
                closeSheet();
                showToast(`Tariff set · ₦${fU(v)}/kWh`);
              }}
            />
          )}
        </div>
      </div>

      {confirm && (
        <>
          <div onClick={() => setConfirm(false)} className="fixed inset-0 z-[70] bg-[rgba(25,23,18,0.5)]" />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="fixed top-1/2 left-1/2 z-[71] flex w-[min(400px,calc(100%-40px))] -translate-1/2 flex-col gap-3 rounded-[22px] bg-card p-[22px] shadow-[0_20px_50px_rgba(25,23,18,0.3)]"
          >
            <span id="confirm-title" className="text-[22px] font-extrabold tracking-[-0.02em]">
              Save as My Home?
            </span>
            <span className="text-[15px] leading-[1.45] text-body-2">
              This replaces your current setup with the simulation.
              {offCount ? ` ${offCount} switched-off device${offCount > 1 ? "s" : ""} will be removed.` : ""}
            </span>
            <div className="mt-1.5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="h-[52px] rounded-[14px] border-[1.5px] border-line-strong text-[15px] font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={confirmSave}
                className="h-[52px] rounded-[14px] bg-ink text-[15px] font-bold text-card"
              >
                Replace
              </button>
            </div>
          </div>
        </>
      )}

      <Toast toast={toast} shown={toastShown} bottom={sheetShown || confirm ? 24 : 104} />
    </div>
  );
}
