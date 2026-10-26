"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { derivedTariff } from "@calgy/engine/appliances";
import { BEFORE_TOKEN_OFFSET_MS, STALE_READING_DAYS } from "@calgy/engine/calibration-constants";
import { loadDraft, loadGen, loadHome, loadMeter, loadSpend, saveDraft, saveGen, saveMeter, saveSpend } from "@/lib/data/store";
import { isPushSubscribed } from "@/lib/push/push";
import type { Device } from "@calgy/engine/energy";
import {
  commas, digits, fromLocalInput, fU, iso, naira, nowLocalInput, num, shortDate, todayIso, toLocalInput, trim, uid,
} from "@calgy/engine/format";
import {
  GEN_ID, genSummary, naira10, OB_FUEL_ID, resolveKw, type FuelPurchase, type GeneratorProfile,
} from "@calgy/engine/generator";
import { calibrateHome, inferredHoursPatch } from "@calgy/engine/home-calibration";
import {
  computeActualDaily, DEFAULT_METER_STATE, latestReading, localNoon, meterSnapshot, readingPairs, reminderDue,
  sortReadings, tokensFromEntries, type MeterReading, type MeterState,
} from "@calgy/engine/meter";
import {
  byNewest, DEFAULT_SETTINGS, makeSample, OB_TOPUP_ID, unitPrice, type Entry, type EntryType, type Settings,
} from "@calgy/engine/spend";
import { LinkNudge } from "../account/LinkNudge";
import { SyncStatus } from "../sync/SyncStatus";
import { GenInsightCard } from "../Calibration";
import { Logo, Toast, useEscape, useToast } from "../ui";
import { Dashboard } from "./Dashboard";
import { draftSize, GenReport, GenSteps, stepError, type GenDraft, type GenStep } from "./GenOnboarding";
import { Insights } from "./Insights";
import { LogSheet, tokenFieldsError, type SheetState } from "./LogSheet";
import { meterStepError, MeterSteps } from "./MeterOnboarding";
import { MeterCard, MeterView, ReminderBanner } from "./MeterView";
import { obMonthly, obProfile, Onboarding, Reveal, usesGen, usesGrid, type ObState } from "./Onboarding";
import { closedReadingSheet, ReadingSheet, readingSheetError, type ReadingSheetState } from "./ReadingSheet";
import { SettingsView } from "./SettingsView";

type View = "onboard" | "meterOb" | "gen" | "reveal" | "genReveal" | "genView" | "home" | "meter" | "insights" | "settings";
type Draft = { view: View; ob: ObState; gen: GenDraft };
type Data = {
  entries: Entry[];
  settings: Settings;
  generator: GeneratorProfile | null;
  purchases: FuelPurchase[];
  draft: Draft | null;
  tariffOverride: number | null;
  devices: Device[];
  readings: MeterReading[];
  meter: MeterState;
  /** Opened from a settings sub-page's back link (/app#settings). */
  openSettings?: boolean;
};

const DRAFT_KEY = "onboarding";
const DEMO_SETTINGS: Settings = { ...DEFAULT_SETTINGS, onboarded: true, fuelWeekly: 25000, tokenMonthly: 40000 };

/**
 * Spend tracker: onboarding, dashboard, log sheet, meter, settings.
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
          devices: [], readings: [], meter: DEFAULT_METER_STATE,
        })
      : Promise.all([loadSpend(), loadGen(), loadDraft<Draft>(DRAFT_KEY), loadHome(), loadMeter()]).then(
          ([spend, gen, draft, home, meter]) => ({
            ...spend, ...gen, draft, tariffOverride: home.tariffOverride, devices: home.devices, ...meter,
          }),
        );
    load.then((d) => live && setData({ ...d, openSettings: !demo && window.location.hash === "#settings" }));
    return () => {
      live = false;
    };
  }, [demo]);

  if (!data) return <div className="min-h-screen bg-paper" />;
  return <SpendView initial={data} demo={demo} />;
}

const obFrom = (s: Settings, entries: Entry[], meter: MeterState): ObState => {
  const topup = entries.find((e) => e.id === OB_TOPUP_ID);
  const p = meter.profile;
  return {
    source: s.source ?? "nepa",
    fuel: s.fuelWeekly ? commas(s.fuelWeekly) : "",
    step: 1,
    unitsLeft: "", // a fresh reading each time: the meter has moved on
    dailyKwh: p.meterDailyAvgKwh ? String(p.meterDailyAvgKwh) : "",
    daysLeft: "",
    totalUsed: p.lifetimeKwh ? String(p.lifetimeKwh) : "",
    startDate: p.meterStartDate ?? "",
    topupDate: topup?.date ?? todayIso(),
    topupPrice: topup ? commas(topup.amount_naira) : "",
    topupUnits: topup?.quantity != null ? String(topup.quantity) : "",
    hoursMode: s.gridHoursSource === "user" ? "set" : "auto",
    hours: s.gridHoursSource === "user" ? String(s.gridHours) : "",
  };
};

/** Drafts saved before the meter questions existed had numeric hours and fewer fields. */
const resumeOb = (raw: Partial<ObState> & { hours?: unknown }, base: ObState): ObState => ({
  ...base,
  ...raw,
  step: raw.step === 2 || raw.step === 3 ? raw.step : 1,
  hours: raw.hours == null ? base.hours : String(raw.hours),
  hoursMode: raw.hoursMode ?? base.hoursMode,
});

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

/** A minute before the token, but never before a reading already taken in that minute. */
function beforeTokenTime(loadedAt: string, readings: MeterReading[]) {
  const t = Date.parse(loadedAt);
  const prev = readings.map((r) => Date.parse(r.takenAt)).filter((x) => x < t);
  const after = prev.length ? Math.max(...prev) + 1000 : -Infinity;
  return new Date(Math.min(t - 1, Math.max(t - BEFORE_TOKEN_OFFSET_MS, after))).toISOString();
}

const emptySheet = (type: EntryType): SheetState => ({
  shown: false, mode: "new", id: null, type, amount: "", qty: "", hours: "", date: todayIso(), note: "",
  before: "", skipBefore: false, loadedAt: nowLocalInput(), loadedAtEdited: false,
});

function SpendView({ initial, demo }: { initial: Data; demo: boolean }) {
  const resume = !initial.settings.onboarded ? initial.draft : null;
  const [entries, setEntries] = useState(initial.entries);
  const [settings, setSettings] = useState(initial.settings);
  const [generator, setGenerator] = useState(initial.generator);
  const [purchases, setPurchases] = useState(initial.purchases);
  const [readings, setReadings] = useState(initial.readings);
  const [meter, setMeter] = useState(initial.meter);
  const { devices } = initial;
  const [view, setView] = useState<View>(
    resume?.view ?? (initial.settings.onboarded ? (initial.openSettings ? "settings" : "home") : "onboard"),
  );
  const [offset, setOffset] = useState(0);
  const [ob, setOb] = useState<ObState>(() => {
    const base = obFrom(initial.settings, initial.entries, initial.meter);
    return resume?.ob ? resumeOb(resume.ob, base) : base;
  });
  const [genDraft, setGenDraft] = useState<GenDraft>(
    () => resume?.gen ?? genFrom(initial.generator, initial.purchases, initial.entries),
  );
  /** Set while editing only the gen size; the view to return to. */
  const [sizeReturn, setSizeReturn] = useState<View | null>(null);
  const [sheet, setSheetState] = useState<SheetState>(emptySheet("fuel"));
  const [rSheet, setRSheetState] = useState<ReadingSheetState>(closedReadingSheet);
  const [reminderHidden, setReminderHidden] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const beforeRef = useRef<HTMLInputElement>(null);
  const unitsRef = useRef<HTMLInputElement>(null);
  const { toast, shown: toastShown, show: showToastNow } = useToast(2800);
  /** Logging copy gets "(will sync when online)" while offline. */
  const showToast = (msg: string, actionLabel?: string, action?: () => void) =>
    showToastNow(!demo && !navigator.onLine ? `${msg} (will sync when online)` : msg, actionLabel, action);

  useEffect(() => {
    if (!demo) saveSpend(entries, settings);
  }, [entries, settings, demo]);

  useEffect(() => {
    if (!demo) saveGen(generator, purchases);
  }, [generator, purchases, demo]);

  useEffect(() => {
    if (!demo) saveMeter(readings, meter);
  }, [readings, meter, demo]);

  // Keep half-finished first-run answers so leaving mid-flow resumes at the same step.
  useEffect(() => {
    if (demo) return;
    const mid = !settings.onboarded && (view === "onboard" || view === "meterOb" || view === "gen");
    saveDraft<Draft>(DRAFT_KEY, mid ? { view, ob, gen: genDraft } : null);
  }, [demo, view, ob, genDraft, settings.onboarded]);

  // Weekly reminder as a notification: installed app with permission only, at most once a day.
  useEffect(() => {
    if (demo || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!window.matchMedia?.("(display-mode: standalone)").matches) return;
    if (!reminderDue(initial.meter, latestReading(initial.readings), new Date(), STALE_READING_DAYS).notify) return;
    // Push reminders (from the server) replace this one.
    isPushSubscribed().then((pushOn) => {
      if (pushOn) return;
      try {
        if (localStorage.getItem("calgy-meter-reminded") === todayIso()) return;
        localStorage.setItem("calgy-meter-reminded", todayIso());
      } catch {
        return;
      }
      new Notification("Check your meter", { body: "One number keeps your Calgy estimates accurate." });
    });
  }, [demo, initial]);

  const grid = usesGrid(settings.source);
  /** Prepaid homes are asked what the meter shows before each new token. */
  const askMeter = grid && !demo;
  const tokens = useMemo(() => tokensFromEntries(entries), [entries]);
  const actual = useMemo(() => computeActualDaily(readings, tokens, meter.profile, new Date()), [readings, tokens, meter.profile]);
  const cal = useMemo(
    () => calibrateHome({ settings, devices, entries, readings, meter, generator, purchases }),
    [settings, devices, entries, readings, meter, generator, purchases],
  );
  // Light hours the meter worked out are saved (never over hours the user set).
  const hoursPatch = inferredHoursPatch(settings, cal);
  if (hoursPatch) setSettings((s) => ({ ...s, ...hoursPatch }));

  const setSheet = (p: Partial<SheetState>) => setSheetState((s) => ({ ...s, ...p }));
  const setRSheet = (p: Partial<ReadingSheetState>) => setRSheetState((s) => ({ ...s, ...p }));

  /** Open the log sheet. `win` = a reading window a missing token was loaded in (ISO times). */
  const openSheet = (type: EntryType, entry?: Entry, win?: { before: string; after: string }) => {
    const hrs = entry && purchases.find((p) => p.id === entry.id)?.hoursRun;
    const winAt = win && new Date(Math.max(Date.parse(win.after) + 60_000, Date.parse(win.before) - 120_000)).toISOString();
    setSheetState(
      entry
        ? {
            ...emptySheet(entry.type), shown: true, mode: "edit", id: entry.id, amount: commas(entry.amount_naira),
            qty: entry.quantity != null ? String(entry.quantity) : "", hours: hrs ? String(hrs) : "",
            date: entry.date, note: entry.note || "", loadedAt: toLocalInput(entry.loaded_at ?? localNoon(entry.date)),
          }
        : { ...emptySheet(type), shown: true, skipBefore: !!win, loadedAt: winAt ? toLocalInput(winAt) : nowLocalInput(), loadedAtEdited: !!win },
    );
    // Focus synchronously inside the tap so mobile keyboards open.
    if (entry) return;
    if (type === "token" && askMeter && !win) beforeRef.current?.focus({ preventScroll: true });
    else amountRef.current?.focus({ preventScroll: true });
  };

  const closeSheet = useCallback(() => {
    amountRef.current?.blur();
    beforeRef.current?.blur();
    setSheetState((s) => ({ ...s, shown: false }));
  }, []);
  useEscape(sheet.shown, closeSheet);

  const usedSince = (prev: MeterReading, cur: MeterReading, toks = tokens) => {
    const p = readingPairs([prev, cur], toks)[0];
    return p && !p.flag ? `You used ${fU(p.used!)} units since ${shortDate(prev.takenAt)} (~${fU(p.perDay!)}/day).` : null;
  };

  const saveEntry = () => {
    const amt = num(digits(sheet.amount));
    const isTok = sheet.type === "token";
    const askBefore = isTok && sheet.mode === "new" && askMeter;
    if (!amt || tokenFieldsError(sheet, askBefore) !== null) return;
    const q = num(sheet.qty) || null;
    const loadedAt = !isTok
      ? undefined
      : sheet.mode === "new" && !sheet.loadedAtEdited
        ? new Date().toISOString()
        : fromLocalInput(sheet.loadedAt || nowLocalInput());
    const date = loadedAt ? iso(new Date(loadedAt)) : sheet.date || todayIso();
    const old = sheet.id ? entries.find((e) => e.id === sheet.id) : undefined;
    const before: MeterReading | null =
      askBefore && !sheet.skipBefore && sheet.before.trim()
        ? {
            id: uid(), unitsLeft: num(sheet.before), context: "before_token",
            takenAt: beforeTokenTime(loadedAt!, readings),
          }
        : null;
    const beforeId = before?.id ?? (isTok ? old?.before_reading_id : undefined);
    const rec: Entry = {
      id: sheet.id || uid(), type: sheet.type, amount_naira: amt, quantity: q, unit_price: unitPrice(amt, q),
      date, note: sheet.note.trim() || null, created_at: old ? old.created_at : new Date().toISOString(),
      ...(loadedAt ? { loaded_at: loadedAt } : {}),
      ...(beforeId ? { before_reading_id: beforeId } : {}),
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
    if (before) setReadings((rs) => [...rs, before]);
    if (askBefore) setMeter((m) => ({ ...m, tokenSkips: before ? 0 : m.tokenSkips + 1 }));
    setOffset(offsetFor(date));
    closeSheet();

    const prevReading = before && sortReadings(readings.filter((r) => Date.parse(r.takenAt) < Date.parse(before.takenAt))).at(-1);
    const used = before && prevReading ? usedSince(prevReading, before) : null;
    if (used) return showToast(`Token logged. ${used}`);
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

  // ——— Meter readings ———

  const openReading = (r?: MeterReading) => {
    setRSheetState(
      r
        ? {
            shown: true, mode: "edit", id: r.id, units: String(r.unitsLeft),
            daysLeft: r.meterDaysLeft != null ? String(r.meterDaysLeft) : "", avg: r.meterDailyAvgKwh ? String(r.meterDailyAvgKwh) : "",
            more: r.meterDaysLeft != null || !!r.meterDailyAvgKwh, earlier: true, takenAt: toLocalInput(r.takenAt),
          }
        : { ...closedReadingSheet, shown: true },
    );
    if (!r) unitsRef.current?.focus({ preventScroll: true });
  };

  const closeReading = useCallback(() => {
    unitsRef.current?.blur();
    setRSheetState((s) => ({ ...s, shown: false }));
  }, []);
  useEscape(rSheet.shown, closeReading);

  const saveReading = () => {
    if (readingSheetError(rSheet) !== null) return;
    const old = rSheet.id ? readings.find((r) => r.id === rSheet.id) : undefined;
    const avg = num(rSheet.avg) || undefined;
    const rec: MeterReading = {
      id: old?.id ?? uid(),
      unitsLeft: num(rSheet.units),
      takenAt: rSheet.earlier && rSheet.takenAt ? fromLocalInput(rSheet.takenAt) : (old?.takenAt ?? new Date().toISOString()),
      context: old?.context ?? "check_in",
      ...(rSheet.daysLeft.trim() ? { meterDaysLeft: num(rSheet.daysLeft) } : {}),
      ...(avg ? { meterDailyAvgKwh: avg } : {}),
    };
    const next = [...readings.filter((r) => r.id !== rec.id), rec];
    setReadings(next);
    if (avg && latestReading(next)?.id === rec.id) setMeter((m) => ({ ...m, profile: { ...m.profile, meterDailyAvgKwh: avg } }));
    // The onboarding "last token" was loaded before the onboarding reading; keep it there if the reading moves earlier.
    let nextEntries = entries;
    const latestOb = sortReadings(next.filter((r) => r.context === "onboarding")).at(-1);
    const obTok = latestOb?.id === rec.id ? tokens.find((t) => t.id === OB_TOPUP_ID) : undefined;
    if (obTok && Date.parse(obTok.loadedAt) >= Date.parse(rec.takenAt)) {
      const at = new Date(Date.parse(rec.takenAt) - 2 * 60_000).toISOString();
      nextEntries = entries.map((e) => (e.id === OB_TOPUP_ID ? { ...e, loaded_at: at, date: iso(new Date(at)) } : e));
      setEntries(nextEntries);
    }
    closeReading();

    const nextTokens = nextEntries === entries ? tokens : tokensFromEntries(nextEntries);
    const pair = readingPairs(next, nextTokens).find((p) => p.to.id === rec.id);
    const saved = old ? "Reading updated." : "Reading saved.";
    if (pair?.flag === "suspect")
      return showToast("Your units went up. Did you load a token?", "Log token", () =>
        openSheet("token", undefined, { before: pair.to.takenAt, after: pair.from.takenAt }),
      );
    if (pair?.flag === "missing_units") {
      const tok = entries.find((e) => e.id === pair.missingTokenId);
      return showToast(`${saved} Add units to your last token to count it.`, "Add units", () => tok && openSheet("token", tok));
    }
    if (pair?.flag === "outlier") return showToast(`${saved} That's a lot of usage — double-check it.`);
    showToast(pair && !pair.flag ? `${saved} ${usedSince(pair.from, pair.to, nextTokens)}` : saved);
  };

  const deleteReading = () => {
    const gone = readings.find((r) => r.id === rSheet.id);
    if (!gone) return;
    setReadings((rs) => rs.filter((r) => r.id !== gone.id));
    closeReading();
    showToast("Reading deleted", "Undo", () => {
      setReadings((rs) => [...rs, gone]);
      showToast("Restored");
    });
  };

  const setHours = (h: number) => {
    setSettings((s) => ({ ...s, gridHours: Math.min(24, Math.max(0, h)), gridHoursSource: "user", gridHoursRange: null }));
    setMeter((m) => ({ ...m, suggestionKeptAt: null }));
    showToast(`Light hours set · ${h}h a day`);
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

  // ——— Onboarding ———

  const obEstimate = obMonthly(ob).monthly;
  const saveOb = (extra: Partial<Settings> = {}) => {
    const onGrid = usesGrid(ob.source);
    const setH = ob.hoursMode === "set" && ob.hours.trim() !== "";
    setSettings((s) => ({
      ...s,
      source: ob.source,
      fuelWeekly: num(digits(ob.fuel)),
      tokenMonthly: Math.round(obMonthly(ob).tokenM),
      ...(onGrid && setH
        ? { gridHours: Math.min(24, num(ob.hours)), gridHoursSource: "user" as const, gridHoursRange: null }
        : onGrid && s.gridHoursSource === "user"
          ? { gridHoursSource: "none" as const, gridHoursRange: null }
          : {}),
      ...extra,
    }));

    // The reading taken at the meter; going back and forth updates the same one.
    let takenAt = new Date().toISOString();
    if (onGrid && ob.unitsLeft.trim()) {
      const id = ob.readingId ?? uid();
      const prev = readings.find((r) => r.id === id);
      const units = num(ob.unitsLeft);
      if (prev && prev.unitsLeft === units) takenAt = prev.takenAt;
      const avg = num(ob.dailyKwh) || undefined;
      const rec: MeterReading = {
        id, unitsLeft: units, takenAt, context: "onboarding",
        ...(ob.daysLeft.trim() ? { meterDaysLeft: num(ob.daysLeft) } : {}),
        ...(avg ? { meterDailyAvgKwh: avg } : {}),
      };
      setReadings((rs) => [...rs.filter((r) => r.id !== id), rec]);
      if (!ob.readingId) setOb((o) => ({ ...o, readingId: id }));
      setMeter((m) => ({ ...m, profile: obProfile(ob) }));
    }

    // The last top-up doubles as the first token log; a fixed id keeps redoing onboarding from duplicating it.
    // It was loaded before the reading above, so it never counts as loaded after it.
    const amt = num(digits(ob.topupPrice));
    const q = num(ob.topupUnits) || null;
    setEntries((es) => {
      const rest = es.filter((e) => e.id !== OB_TOPUP_ID);
      if (!onGrid || !amt) return rest;
      const old = es.find((e) => e.id === OB_TOPUP_ID);
      const date = ob.topupDate || todayIso();
      const rec: Entry = {
        id: OB_TOPUP_ID, type: "token", amount_naira: amt, quantity: q, unit_price: unitPrice(amt, q),
        date, note: null, created_at: old?.created_at ?? new Date().toISOString(),
        loaded_at: new Date(Math.min(Date.parse(localNoon(date)), Date.parse(takenAt) - 2 * 60_000)).toISOString(),
      };
      return [rec, ...rest];
    });
  };

  const meterNext = () => {
    if (meterStepError(ob, ob.step) !== null) return;
    window.scrollTo(0, 0);
    if (ob.step < 3) return setOb((o) => ({ ...o, step: (o.step + 1) as 2 | 3 }));
    if (usesGen(ob.source)) {
      saveOb();
      setView("gen");
    } else if (obEstimate) {
      saveOb();
      setView("reveal");
    } else {
      saveOb({ onboarded: true });
      setView("home");
    }
  };

  const meterBack = () => {
    if (ob.step === 1) setView("onboard");
    else setOb((o) => ({ ...o, step: (o.step - 1) as 1 | 2 }));
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
    } else if (g.step === 1) setView(usesGrid(ob.source) ? "meterOb" : "onboard");
    else if (g.step === 2 && g.prefill && g.prefillUsed === false) setGenDraft((s) => ({ ...s, prefillUsed: null }));
    else if (g.step === 4 && g.prefillUsed && g.prefill?.litres) goStep(2);
    else goStep((g.step - 1) as GenStep);
  };

  const genNext = () => {
    if (stepError(genDraft, genDraft.step) !== null) return;
    if (sizeReturn || genDraft.step === 4) finishGen();
    else goStep((genDraft.step + 1) as GenStep);
  };

  // ——— Derived numbers ———

  const summary = generator ? genSummary(generator, purchases) : null;
  const meterTariffValue = initial.tariffOverride ?? derivedTariff(entries)?.value ?? null;
  const tariff = initial.tariffOverride ? { value: initial.tariffOverride, source: "Set by you" } : derivedTariff(entries);
  const calPerKwh = settings.calibrate ? (cal.gen?.nairaPerKwh ?? null) : null;
  const genLine = summary
    ? `${summary.nairaPerHour != null ? `~${naira10(summary.nairaPerHour)}/hr · ` : ""}${
        calPerKwh != null ? `~${naira10(calPerKwh)}` : `${naira10(summary.perKwhLow)}–${naira10(summary.perKwhHigh)}`
      }/unit`
    : undefined;
  const now = new Date();
  const snap = meterSnapshot(readings, tokens, meter.profile, actual.value, now);
  const due = reminderDue(meter, snap?.last ?? null, now, STALE_READING_DAYS);
  const hoursUsed = cal.grid && settings.gridHoursSource !== "none" ? cal.grid.gridHoursUsed : null;
  const genInsight = <GenInsightCard r={cal} enabled={settings.calibrate} gridTariff={meterTariffValue} />;

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
              window.scrollTo(0, 0);
              if (usesGrid(ob.source)) {
                setOb((o) => ({ ...o, step: 1 }));
                setView("meterOb");
              } else {
                saveOb();
                setView("gen");
              }
            }}
          />
        )}
        {view === "meterOb" && (
          <MeterSteps ob={ob} setOb={setOb} hasEstimate={obEstimate > 0} onBack={meterBack} onNext={meterNext} />
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
            onAdjust={() => {
              setOb((o) => ({ ...o, step: 1 }));
              setView("meterOb");
            }}
          />
        )}
        {view === "genReveal" && generator && summary && (
          <GenReport
            gen={generator}
            summary={summary}
            meterTariff={meterTariffValue}
            calibratedPerKwh={calPerKwh}
            insight={genInsight}
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
            meterTariff={meterTariffValue}
            calibratedPerKwh={calPerKwh}
            insight={genInsight}
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
            statusSlot={demo ? null : <SyncStatus className="mt-1" />}
            meterSlot={
              grid && !demo ? (
                <>
                  <LinkNudge entries={entries.length + readings.length} />
                  {due.banner && !reminderHidden && (
                    <ReminderBanner onLog={() => openReading()} onDismiss={() => setReminderHidden(true)} />
                  )}
                  <MeterCard
                    snap={snap}
                    onOpen={() => {
                      setView("meter");
                      window.scrollTo(0, 0);
                    }}
                    onLog={() => openReading()}
                  />
                </>
              ) : demo ? null : (
                <LinkNudge entries={entries.length + readings.length} />
              )
            }
            onLoadSample={() => {
              loadSample(false);
              showToast("Sample data loaded — erase it in Settings");
            }}
          />
        )}
        {view === "meter" && (
          <MeterView
            readings={readings}
            entries={entries}
            meter={meter}
            tariff={tariff}
            actual={actual}
            cal={cal}
            enabled={settings.calibrate}
            now={now}
            onBack={() => setView("home")}
            onLogReading={() => openReading()}
            onEditReading={openReading}
            onLogToken={(before, after) => openSheet("token", undefined, before && after ? { before, after } : undefined)}
            onFixToken={(id) => {
              const e = entries.find((x) => x.id === id);
              if (e) openSheet("token", e);
            }}
            onEditToken={(e) => openSheet("token", e)}
            onSetHours={setHours}
            onKeepHours={() => setMeter((m) => ({ ...m, suggestionKeptAt: cal.grid?.confidence ?? "rough" }))}
            onReminder={(p) => setMeter((m) => ({ ...m, reminder: { ...m.reminder, ...p } }))}
          />
        )}
        {view === "insights" && (
          <Insights
            entries={entries}
            settings={settings}
            supply={
              cal.grid
                ? {
                    hours: Math.round(cal.grid.gridHoursUsed),
                    label:
                      settings.gridHoursSource === "inferred"
                        ? "Worked out from your meter"
                        : settings.gridHoursSource === "user"
                          ? "From the light hours you set"
                          : "Assumed until your meter readings tell us",
                  }
                : undefined
            }
            onBack={() => setView("home")}
          />
        )}
        {view === "settings" && (
          <SettingsView
            entryCount={entries.length}
            settings={settings}
            genLine={genLine}
            hours={grid ? { value: hoursUsed, source: settings.gridHoursSource } : null}
            onBack={() => setView("home")}
            onRedo={() => {
              setOb(obFrom(settings, entries, meter));
              setGenDraft(genFrom(generator, purchases, entries));
              setView("onboard");
            }}
            onHours={(d) =>
              setSettings((s) => ({
                ...s,
                gridHours: Math.min(24, Math.max(0, Math.round(hoursUsed ?? cal.grid?.gridHoursUsed ?? s.gridHours) + d)),
                gridHoursSource: "user",
                gridHoursRange: null,
              }))
            }
            onHoursAuto={() => setSettings((s) => ({ ...s, gridHoursSource: "none", gridHoursRange: null }))}
            onCalibrate={(on) => setSettings((s) => ({ ...s, calibrate: on }))}
            demo={demo}
            onSample={() => {
              loadSample(true);
              showToast("Sample data loaded");
            }}
            onErase={() => {
              setEntries([]);
              setSettings({ ...DEFAULT_SETTINGS });
              setGenerator(null);
              setPurchases([]);
              setReadings([]);
              setMeter(DEFAULT_METER_STATE);
              setOb(obFrom(DEFAULT_SETTINGS, [], DEFAULT_METER_STATE));
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
        askMeter={askMeter}
        nudge={meter.tokenSkips >= 2}
        beforeRef={beforeRef}
        amountRef={amountRef}
        onClose={closeSheet}
        onSave={saveEntry}
        onDelete={deleteEntry}
      />
      <ReadingSheet
        sheet={rSheet}
        setSheet={setRSheet}
        unitsRef={unitsRef}
        onClose={closeReading}
        onSave={saveReading}
        onDelete={deleteReading}
      />

      <Toast toast={toast} shown={toastShown} bottom={view === "home" && !sheet.shown && !rSheet.shown ? 108 : 24} />
    </div>
  );
}
