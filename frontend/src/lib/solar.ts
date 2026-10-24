// Calgy — Solar Compare: constants + pure model.
// Ported from design_handoff_calgy_solar (solar.ts + the prototype's logic class).
// Device energy maths comes from the shared engine (energy.ts). Solar sizes for full supply:
// what the home would run if power were always there.

import { fromPreset, lagosFlat, PRESET_BY, sumTrio, type Device } from "./appliances";
import { isKwhBased, resolveDraw } from "./energy";
import { fU, iso, num, trimN } from "./format";
import type { Entry, Settings } from "./spend";

export const HEAVY_PRESETS = ["ac-1hp", "ac-15hp", "ac-2hp", "ac-15hp-inv", "iron", "kettle", "pump-05", "pump-1", "heater"];
export const HEAVY_WATTS = 800; // any non-charging device ≥ this (typical tier) defaults to Heavy

export const INVERTERS: [kva: number, priceNaira: number][] = [
  [1, 220_000], [1.5, 320_000], [2.5, 480_000], [3.5, 680_000],
  [5, 950_000], [7.5, 1_450_000], [10, 1_900_000], [15, 2_800_000],
];
// Verify before launch: prices, night share and sun hours are design-time estimates, not sourced data.
export const SUN_HOURS = 4.5; // peak sun hours / day (national average, no location data)
export const SYSTEM_EFF = 0.75; // panel → usable after losses
export const NIGHT_SHARE = 0.6; // share of daily kWh used after dark → battery
export const HEADROOM = 1.25; // inverter surge headroom
export const POWER_FACTOR = 0.8;
export const PANEL_W = 450;
export const PANEL_PRICE = 140_000;
export const LITHIUM = { dod: 0.9, pricePerKwh: 340_000, moduleKwh: (volt: number) => (volt >= 48 ? 5 : 2.5) };
export const TUBULAR = { dod: 0.5, unitKwh: 2.64 /* 12V 220Ah */, unitPrice: 420_000 };
export const INSTALL = { pct: 0.15, base: 120_000 }; // 15% of hardware + ₦120k, rounded to ₦10k
export const INVERTER_LIFE_MONTHS = 96;
export const HORIZON_MONTHS = 300; // break-even search; totals reported at 60 and 120

// cov = share of covered spend solar actually displaces (rainy season, cloudy days).
// costMult applies only in "By part" (estimate) mode.
export const SCENARIOS = {
  good: { cov: 1.0, costMult: 0.9 },
  typ: { cov: 0.9, costMult: 1.0 },
  bad: { cov: 0.75, costMult: 1.15 },
};

export type Tag = "ess" | "heavy";
export type Scope = "ess" | "whole";
export type BatteryType = "lithium" | "tubular";
export type CostMode = "quote" | "parts" | "plan";
export type PartKey = "inverter" | "battery" | "panels" | "install";

/** Persisted in the `solarSettings` Dexie table (single row). */
export type SolarSettings = {
  tags: Record<string, Tag>; // keyed by device id — kept here so My Home stays clean
  scope: Scope;
  battery: BatteryType;
  costMode: CostMode;
  quote: number | null;
  parts: Partial<Record<PartKey, number>>;
  plan: { deposit: number | null; monthly: number | null; months: number };
  assumptions: {
    genPrice: number;
    genLifeYears: number;
    solarUpkeep: number;
    batteryLife: { lithium: number; tubular: number };
  };
  spendOverride: { fuel: number; token: number } | null;
  genServicing: number | null;
};

export const DEFAULT_SOLAR: SolarSettings = {
  tags: {},
  scope: "ess",
  battery: "lithium",
  costMode: "parts",
  quote: null,
  parts: {},
  plan: { deposit: null, monthly: null, months: 24 },
  assumptions: { genPrice: 350_000, genLifeYears: 3, solarUpkeep: 3_000, batteryLife: { lithium: 8, tubular: 3 } },
  spendOverride: null,
  genServicing: null,
};

/** Merge a possibly partial/old stored row over the defaults. */
export const normaliseSolar = (s: Partial<SolarSettings> | null | undefined): SolarSettings => ({
  ...DEFAULT_SOLAR,
  ...(s ?? {}),
  plan: { ...DEFAULT_SOLAR.plan, ...(s?.plan ?? {}) },
  assumptions: {
    ...DEFAULT_SOLAR.assumptions,
    ...(s?.assumptions ?? {}),
    batteryLife: { ...DEFAULT_SOLAR.assumptions.batteryLife, ...(s?.assumptions?.batteryLife ?? {}) },
  },
});

/** Compact ₦: ₦950, ₦3.5k, ₦37k, ₦1.67M, ₦12.5M. */
export const money = (v: number) => {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e6) return s + "₦" + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  if (a >= 1e4) return s + "₦" + Math.round(a / 1e3) + "k";
  if (a >= 1e3) return s + "₦" + Math.round(a / 100) / 10 + "k";
  return s + "₦" + Math.round(a);
};

/** ≤36 months → "19 months"; else years to nearest 0.5 → "3.5 years". */
export const durationLabel = (m: number) =>
  m <= 36 ? `${m} month${m === 1 ? "" : "s"}` : `${Math.round(m / 6) / 2} years`;

/** Watts while running (typical): energy-label devices use the compressor's draw, not the daily average. */
const runningW = (d: Device) => {
  const w = resolveDraw(d).typical;
  if (!isKwhBased(d)) return w;
  const fb = d.presetId ? PRESET_BY[d.presetId]?.fallback : undefined;
  return fb ? fb.watts[1] : w / 0.45;
};

/** Running watts for peak sizing. Charging devices draw Wh ÷ 2, minimum 5W. */
export const runWatts = (d: Device) =>
  (d.usage.profile === "charges" ? Math.max(5, runningW(d) / 2) : runningW(d)) * Math.max(1, num(d.quantity));

export const isHeavyDefault = (d: Device) =>
  HEAVY_PRESETS.includes(d.presetId ?? "") || (d.usage.profile !== "charges" && runningW(d) >= HEAVY_WATTS);

export const tagOf = (tags: Record<string, Tag>, d: Device): Tag => tags[d.id] ?? (isHeavyDefault(d) ? "heavy" : "ess");

/** Peak = all Essentials at full draw + biggest Heavy + 30% of remaining Heavy. */
export function peakWatts(essW: number[], heavyW: number[]) {
  const h = [...heavyW].sort((a, b) => b - a);
  return essW.reduce((a, b) => a + b, 0) + (h[0] ?? 0) + 0.3 * h.slice(1).reduce((a, b) => a + b, 0);
}

export function sizeSystem(dailyKwh: number, peakW: number, battery: BatteryType) {
  const needVA = (peakW * HEADROOM) / POWER_FACTOR;
  const [kva, invPrice] = INVERTERS.find(([k]) => k * 1000 >= needVA) ?? INVERTERS[INVERTERS.length - 1];
  const volt = kva <= 1 ? 12 : kva <= 2.5 ? 24 : 48;
  const usable = dailyKwh * NIGHT_SHARE;
  let bat: { count: number; kwh: number; price: number; usableKwh: number; moduleKwh: number };
  if (battery === "lithium") {
    const mod = LITHIUM.moduleKwh(volt);
    const count = Math.max(1, Math.ceil(usable / LITHIUM.dod / mod));
    bat = { count, kwh: count * mod, price: count * mod * LITHIUM.pricePerKwh, usableKwh: count * mod * LITHIUM.dod, moduleKwh: mod };
  } else {
    const str = volt / 12;
    const count = Math.max(str, Math.ceil(usable / TUBULAR.dod / TUBULAR.unitKwh / str) * str);
    bat = {
      count, kwh: count * TUBULAR.unitKwh, price: count * TUBULAR.unitPrice,
      usableKwh: count * TUBULAR.unitKwh * TUBULAR.dod, moduleKwh: TUBULAR.unitKwh,
    };
  }
  const panelKw = dailyKwh / (SUN_HOURS * SYSTEM_EFF);
  let panels = Math.max(2, Math.ceil((panelKw * 1000) / PANEL_W));
  if (panels % 2) panels++;
  return { needVA, kva, volt, invPrice, usable, battery: bat, panels, panelPrice: panels * PANEL_PRICE, panelKw };
}

export const installEstimate = (hardware: number) => Math.round((hardware * INSTALL.pct + INSTALL.base) / 1e4) * 1e4;

export interface ModelInput {
  cur: number; // current monthly spend: fuel × fuel multiplier + tokens + gen servicing
  share: number; // 1 for whole home; else essentials kWh / all-devices kWh
  solarUpkeep: number;
  upfront: number; // quote or parts total (ignored if plan)
  plan: { deposit: number; monthly: number; months: number } | null;
  batteryCost: number;
  batteryLifeMonths: number;
  inverterCost: number;
  genPrice: number;
  genLifeMonths: number;
  hasFuel: boolean;
}

export type Totals = { now: number; solar: number };
export type ModelResult = {
  breakEvenMonth: number | null;
  displaced: number;
  residual: number;
  savingsMonthly: number;
  totals: { y5: Totals; y10: Totals };
};

/** Month-by-month cumulative cash flow. Break-even = first month cumulative current ≥ cumulative solar. */
export function runModel(i: ModelInput, cov: number, costMult: number): ModelResult {
  const displaced = i.cur * i.share * cov;
  const residual = i.cur - displaced;
  let cc = 0;
  let cs = 0;
  let be: number | null = null;
  const tot = { y5: { now: 0, solar: 0 }, y10: { now: 0, solar: 0 } };
  for (let m = 0; m <= HORIZON_MONTHS; m++) {
    if (m === 0) cs += i.plan ? i.plan.deposit : i.upfront * costMult;
    else {
      const genRepl = i.hasFuel && i.genLifeMonths && m % i.genLifeMonths === 0 ? i.genPrice : 0;
      cc += i.cur + genRepl;
      cs +=
        residual +
        i.solarUpkeep +
        (i.plan && m <= i.plan.months ? i.plan.monthly : 0) +
        (i.batteryLifeMonths && m % i.batteryLifeMonths === 0 ? i.batteryCost : 0) +
        (m % INVERTER_LIFE_MONTHS === 0 ? i.inverterCost : 0) +
        genRepl * (1 - i.share); // essentials-only keeps the gen, but it wears proportionally less
      if (be === null && cc >= cs) be = m;
    }
    if (m === 60) tot.y5 = { now: cc, solar: cs };
    if (m === 120) tot.y10 = { now: cc, solar: cs };
  }
  return { breakEvenMonth: be, displaced, residual, savingsMonthly: displaced - i.solarUpkeep, totals: tot };
}

export type VerdictTone = "good" | "warn" | "bad";

// ——— Where the "now" figures come from ———

export type SpendSource = {
  kind: "logs" | "estimate" | "none" | "sample";
  label: string;
  fuel: number;
  token: number;
  avgL: number | null; // logged ₦/L, when litres were logged
};

/** Last 30 days of logs (scaled up if the history is shorter), else the quick estimate, else nothing. */
export function readSpendSource(entries: Entry[], settings: Settings, now = new Date()): SpendSource {
  const today = iso(now);
  const cut = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
  if (entries.length) {
    const earliest = entries.reduce((m, e) => (e.date < m ? e.date : m), today);
    const [y, mo, d] = earliest.split("-").map(Number);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const span = Math.min(30, Math.round((startOfToday - new Date(y, mo - 1, d).getTime()) / 864e5) + 1);
    const recent = entries.filter((e) => e.date >= cut && e.date <= today);
    const scale = 30 / Math.max(7, span);
    const sum = (t: Entry["type"]) =>
      recent.filter((e) => e.type === t).reduce((a, e) => a + (e.amount_naira || 0), 0) * scale;
    const fq = recent.filter((e) => e.type === "fuel" && (e.quantity ?? 0) > 0);
    const avgL = fq.length
      ? fq.reduce((a, e) => a + e.amount_naira, 0) / fq.reduce((a, e) => a + (e.quantity ?? 0), 0)
      : null;
    return {
      kind: "logs",
      label: span >= 30 ? "Based on last 30 days of logs" : `Based on ${span} day${span > 1 ? "s" : ""} of logs, scaled to a month`,
      fuel: Math.round(sum("fuel") / 100) * 100,
      token: Math.round(sum("token") / 100) * 100,
      avgL,
    };
  }
  if (settings.fuelWeekly || settings.tokenMonthly)
    return {
      kind: "estimate",
      label: "From your quick estimate in Spend",
      fuel: Math.round(((settings.fuelWeekly || 0) * 52) / 12 / 100) * 100,
      token: settings.tokenMonthly || 0,
      avgL: null,
    };
  return { kind: "none", label: "Nothing logged yet", fuel: 0, token: 0, avgL: null };
}

export const SAMPLE_SOURCE: SpendSource = {
  kind: "sample", label: "Sample household · Lagos flat with AC", fuel: 48_000, token: 26_000, avgL: 1000,
};

/** Lagos flat plus an inverter AC (4h), an iron and a pumping machine. */
export function sampleHousehold(): Device[] {
  const ac = fromPreset(PRESET_BY["ac-15hp-inv"], 1, { hoursPerDay: 4 });
  return [...lagosFlat(), ac, fromPreset(PRESET_BY["iron"]), fromPreset(PRESET_BY["pump-05"])];
}

// ——— Everything the screen shows, from one set of inputs ———

export type SolarInputs = {
  devices: Device[];
  tags: Record<string, Tag>;
  scope: Scope;
  battery: BatteryType;
  costMode: CostMode;
  fuel: number;
  token: number;
  genServicing: number;
  fuelPct: number; // what-if: −20…+50
  quote: number;
  parts: Partial<Record<PartKey, number>>;
  plan: { deposit: number; monthly: number; months: number };
  genPrice: number;
  genLifeYears: number;
  solarUpkeep: number;
  batteryLifeYears: number; // for the selected battery type
};

export function computeSolar(i: SolarInputs) {
  const whole = i.scope === "whole";
  const fm = 1 + i.fuelPct / 100;
  const curBase = i.fuel + i.token + i.genServicing;
  const cur = i.fuel * fm + i.token + i.genServicing;

  // Load
  const solDevs = i.devices.filter((d) => whole || tagOf(i.tags, d) === "ess");
  const day = sumTrio(solDevs, null);
  const homeDay = sumTrio(i.devices, null);
  const share = whole ? 1 : homeDay.typ ? day.typ / homeDay.typ : 0;
  const essW = solDevs.filter((d) => tagOf(i.tags, d) === "ess").map(runWatts);
  const heavyW = solDevs.filter((d) => tagOf(i.tags, d) === "heavy").map(runWatts);
  const peak = peakWatts(essW, heavyW);
  const hasSizing = solDevs.length > 0 && day.typ > 0;

  // System + prices
  const sys = sizeSystem(day.typ, peak, i.battery);
  const est = { inverter: sys.invPrice, battery: sys.battery.price, panels: sys.panelPrice };
  const hwEst = est.inverter + est.battery + est.panels;
  const parts = {
    inverter: i.parts.inverter ?? est.inverter,
    battery: i.parts.battery ?? est.battery,
    panels: i.parts.panels ?? est.panels,
    install: 0,
  };
  const installEst = installEstimate(parts.inverter + parts.battery + parts.panels);
  parts.install = i.parts.install ?? installEst;
  const partsTotal = parts.inverter + parts.battery + parts.panels + parts.install;
  const estTotal = hwEst + installEstimate(hwEst);

  // Readiness
  const plan = i.plan;
  const hasCost =
    i.costMode === "quote" ? i.quote > 0 : i.costMode === "parts" ? partsTotal > 0 : plan.monthly > 0 && plan.months > 0;
  const hasSpend = curBase > 0;
  const ready = hasSizing && hasSpend && hasCost;
  const hasFuel = i.fuel > 0;

  let results: { good: ModelResult; typ: ModelResult; bad: ModelResult } | null = null;
  if (ready) {
    const input: ModelInput = {
      cur, share, solarUpkeep: i.solarUpkeep,
      plan: i.costMode === "plan" ? plan : null,
      upfront: i.costMode === "quote" ? i.quote : partsTotal,
      batteryCost: parts.battery,
      batteryLifeMonths: Math.round(i.batteryLifeYears * 12),
      inverterCost: parts.inverter,
      genPrice: i.genPrice,
      genLifeMonths: Math.round(i.genLifeYears * 12),
      hasFuel,
    };
    const byParts = i.costMode === "parts";
    results = {
      good: runModel(input, SCENARIOS.good.cov, byParts ? SCENARIOS.good.costMult : 1),
      typ: runModel(input, SCENARIOS.typ.cov, 1),
      bad: runModel(input, SCENARIOS.bad.cov, byParts ? SCENARIOS.bad.costMult : 1),
    };
  }

  return {
    whole, fm, cur, curBase, hasFuel, hasSpend, hasCost, hasSizing, ready,
    solDevs, day, homeDay, share, peak, heavyCount: heavyW.length,
    sys, est, installEst, parts, partsTotal, estTotal, results,
  };
}

export type SolarModel = ReturnType<typeof computeSolar>;

/** Headline, range and verdict copy for the break-even card. */
export function breakEvenCopy(r: { good: ModelResult; typ: ModelResult; bad: ModelResult }) {
  const be = r.typ.breakEvenMonth;
  const sav = r.typ.savingsMonthly;
  const lo = r.good.breakEvenMonth;
  const hi = r.bad.breakEvenMonth;
  if (be === null || sav <= 0)
    return {
      main: "Doesn’t pay off",
      size: 40,
      range: lo ? `Best case ~${durationLabel(lo)}` : "Not within 25 years, even in the best case",
      verdict: "At your current spend, solar costs more than it saves. Keep what you have, and check again if fuel or tariffs go up.",
      tone: "bad" as VerdictTone,
      bar: "Doesn’t pay off",
    };
  const yrs = be > 36;
  const f = (m: number | null) => (m == null ? null : yrs ? String(Math.round(m / 6) / 2) : String(m));
  const unit = yrs ? "years" : "months";
  const main = be <= 1 ? "Month 1" : "~" + durationLabel(be);
  const range = hi == null ? `${f(lo) || "1"} ${unit} at best · may never pay off` : `${f(lo)}–${f(hi)} ${unit}`;
  let verdict: string;
  let tone: VerdictTone = "good";
  if (be <= 1) verdict = "You’re ahead from the first month: the plan costs less than you spend on energy now.";
  else if (be <= 36)
    verdict = `Solar starts winning in about ${durationLabel(be)}. After that, roughly ${money(sav)} a month stays in your pocket.`;
  else if (be <= 60) verdict = `Solar pays for itself in about ${durationLabel(be)}. Good value if you’ll stay in this home that long.`;
  else if (be <= 120) {
    verdict = `At your current spend, solar takes about ${durationLabel(be)} to pay off. Only worth it if you’re staying put, or if fuel keeps going up.`;
    tone = "warn";
  } else {
    verdict = `At your current spend, solar takes about ${durationLabel(be)} to pay off. That’s longer than the batteries last. Not worth it yet.`;
    tone = "bad";
  }
  return { main, size: be > 120 ? 48 : 56, range, verdict, tone, bar: main + (be > 1 ? " to break even" : "") };
}

/** Labels for the system card and the "How we sized this" panel. */
export function systemCopy(m: SolarModel, battery: BatteryType) {
  const { sys, day, peak, whole, heavyCount } = m;
  const b = sys.battery;
  const batLabel = battery === "lithium" ? `${trimN(b.kwh)} kWh lithium` : `${b.count} × 220Ah tubular`;
  const batSub =
    battery === "lithium"
      ? `${b.count} × ${b.moduleKwh} kWh module${b.count > 1 ? "s" : ""} · ~${fU(b.kwh * LITHIUM.dod)} kWh usable`
      : `${fU(b.kwh)} kWh total · ~${fU(b.kwh * TUBULAR.dod)} kWh usable · ${sys.volt}V`;
  const batHow =
    battery === "lithium"
      ? `${fU(sys.usable)} units used after dark (60% of ${fU(day.typ)}) ÷ 90% usable on lithium = ${fU(sys.usable / LITHIUM.dod)} kWh → ${trimN(b.kwh)} kWh`
      : `${fU(sys.usable)} units used after dark ÷ 50% usable on tubular = ${fU(sys.usable / TUBULAR.dod)} kWh → ${b.count} × 2.64 kWh at ${sys.volt}V`;
  const peakR = Math.round(peak / 10) * 10;
  const panelKw = (sys.panels * PANEL_W) / 1000;
  return {
    invLabel: `${sys.kva} kVA`,
    invSub: `Handles ~${peakR.toLocaleString("en-NG")}W peak with surge headroom`,
    batLabel,
    batSub,
    panLabel: `${sys.panels} × ${PANEL_W}W`,
    panSub: `${fU(panelKw)} kW · ~${fU(panelKw * SUN_HOURS * SYSTEM_EFF)} units on a sunny day`,
    how: [
      {
        k: "Inverter",
        v:
          `${Math.round(peak)}W peak × 1.25 headroom ÷ 0.8 power factor ≈ ${Math.round(sys.needVA)}VA → next size up, ${sys.kva} kVA` +
          (whole && heavyCount > 1 ? ". Assumes one heavy device at a time, not all at once." : ""),
      },
      { k: "Battery", v: batHow },
      { k: "Panels", v: `${fU(day.typ)} units ÷ (4.5 sun hours × 75% after losses) = ${fU(sys.panelKw)} kW → ${sys.panels} × ${PANEL_W}W` },
    ],
  };
}

