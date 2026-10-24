// Calibration: match device estimates to what the meter (grid) and fuel (generator) say was really used.
// Pure functions only. Energies here are kWh/day unless noted.

import {
  CONFIDENCE_SPREAD, DEFAULT_GRID_HOURS, GEN_CONFIDENCE, GEN_COVERAGE_OK, GRID_ONLY_PRESETS, IDLE_FRACTION, K_MAX, K_MIN,
  L_PER_KWH_FULL, SOLVE_MAX_ITER, SOLVE_TOLERANCE_ENERGY, SOLVE_TOLERANCE_H, SUGGEST_DIFF_FRACTION, SUGGEST_DIFF_HOURS,
} from "./calibration-constants.ts";
import { addRange, dailyEnergyFullSupply, dailyEnergyWithSupply, scaleRange, ZERO, type Device, type Range, type TierKey } from "./energy.ts";
import type { FuelPurchase, FuelType } from "./generator.ts";
import {
  computeActualDaily, daysBetween, localNoon, type ActualDaily, type Confidence, type GridHoursSetting, type MeterProfile,
  type MeterReading, type TokenLoad,
} from "./meter.ts";

export type Household = "grid" | "gen" | "hybrid";
export type Side = "grid" | "gen";

export type Split = { grid: Range; gen: Range }; // kWh/day
const ZERO_SPLIT: Split = { grid: ZERO, gen: ZERO };
const TIER_I = { low: 0, typical: 1, high: 2 } as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isMains = (d: Device) => d.usage.profile === "steady" || d.usage.profile === "cycling";
const kwh = (r: Range) => scaleRange(r, 1 / 1000);

// ——— Power sources & hour allocation (§B2.3–B2.4) ———

export const householdOf = (source: "nepa" | "gen" | "hybrid"): Household =>
  source === "nepa" ? "grid" : source === "gen" ? "gen" : "hybrid";

/** Heavy loads default to grid only in hybrid homes. */
export const defaultSources = (d: Pick<Device, "presetId">): Side[] =>
  d.presetId && GRID_ONLY_PRESETS.includes(d.presetId) ? ["grid"] : ["grid", "gen"];

export function sourcesOf(d: Device, household: Household): Side[] {
  if (household !== "hybrid") return [household];
  const s = d.powerSources?.filter((x) => x === "grid" || x === "gen");
  return s?.length ? s : defaultSources(d);
}

/** Grid first; gen covers the remainder. */
export function allocateHours(h: number, G: number, H: number | null, sources: Side[]) {
  const grid = sources.includes("grid") ? Math.min(h, G) : 0;
  const gen = sources.includes("gen") ? Math.max(0, Math.min(h - grid, H ?? 0)) : 0;
  return { grid, gen };
}

/** One device's daily kWh from each source at G light hours and H gen hours. */
export function deviceSplit(d: Device, G: number, H: number | null, household: Household): Split {
  const src = sourcesOf(d, household);
  if (isMains(d)) {
    const h = clamp(d.usage.hoursPerDay ?? 0, 0, 24);
    const a = allocateHours(h, G, H, src);
    return {
      grid: a.grid > 0 ? kwh(dailyEnergyWithSupply(d, G)) : ZERO,
      gen: a.gen > 0 ? kwh(dailyEnergyWithSupply({ ...d, usage: { ...d.usage, hoursPerDay: a.gen } }, 24)) : ZERO,
    };
  }
  // Battery devices: wall energy over the hours any source is on, split by each source's share of those hours.
  const g = src.includes("grid") ? G : 0;
  const hh = src.includes("gen") ? (H ?? 0) : 0;
  const total = kwh(d.usage.profile === "charges" ? dailyEnergyFullSupply(d) : dailyEnergyWithSupply(d, Math.min(24, g + hh)));
  const gridShare = g + hh > 0 ? g / (g + hh) : src.includes("grid") ? 1 : 0;
  return { grid: scaleRange(total, gridShare), gen: scaleRange(total, 1 - gridShare) };
}

const sumSide = (devices: Device[], side: Side, G: number, H: number | null, hh: Household) =>
  devices.reduce((a, d) => addRange(a, deviceSplit(d, G, H, hh)[side]), ZERO);

/** E_grid(G): grid-side daily kWh across devices. Non-decreasing in G. */
export const gridEnergy = (devices: Device[], G: number, H: number | null = null, household: Household = "grid") =>
  sumSide(devices, "grid", G, H, household);

// ——— Grid calibration (§B4) ———

/** Light hours at which the devices' `tier` total matches `actualDaily`, or null if no G in [0, 24] does. */
export function solveGridHours(
  devices: Device[],
  actualDaily: number,
  tier: TierKey,
  genHours: number | null = null,
  household: Household = "grid",
): number | null {
  const f = (G: number) => gridEnergy(devices, G, genHours, household)[tier];
  if (actualDaily > f(24) || actualDaily < f(0)) return null;
  let a = 0;
  let b = 24;
  // Hours alone aren't enough: where usage rises steeply with each hour, 0.05h can still be several % off.
  for (let i = 0; i < SOLVE_MAX_ITER; i++) {
    const m = (a + b) / 2;
    const e = f(m);
    if (b - a <= SOLVE_TOLERANCE_H && Math.abs(e - actualDaily) <= SOLVE_TOLERANCE_ENERGY * actualDaily) return m;
    if (e < actualDaily) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** [G_low, G_high]: high-draw estimates need fewer hours, low-draw ones more. Unsolvable bounds clamp. */
function hoursRange(devices: Device[], a: number, H: number | null, hh: Household): [number, number] {
  const bound = (tier: TierKey) => {
    const g = solveGridHours(devices, a, tier, H, hh);
    if (g != null) return g;
    return a > gridEnergy(devices, 24, H, hh)[tier] ? 24 : 0;
  };
  return [bound("high"), bound("low")];
}

export type GridStatus = "not_ready" | "matched" | "adjusted" | "mismatch_under" | "mismatch_over";
export type GenStatus = "not_ready" | "gen_matched" | "gen_mismatch_under" | "gen_mismatch_over" | "gen_data_check";

export interface GridResult {
  status: GridStatus;
  mode: "infer_hours" | "adjust_devices" | null;
  confidence: Confidence | null;
  actualDailyKwh: number | null;
  sources: ActualDaily["sources"];
  spanDays: number;
  validPairs: number;
  gridHoursUsed: number;
  inferredGridHours?: { value: number; range: [number, number] };
  /** Mode B: what the meter suggests when it's far from the user's hours. */
  suggestedGridHours?: { value: number; range: [number, number] };
  t?: number;
  k?: number;
  coverage: number | null;
  /** Uncalibrated devices with 24h of light, for "How we matched this". */
  fullSupplyKwh: number;
}

/** Per-device grid kWh/day after positioning (t) or scaling (k); pinned devices keep their value. */
function adjust(devices: Device[], a: number, G: number, H: number | null, hh: Household) {
  const splits = devices.map((d) => deviceSplit(d, G, H, hh).grid);
  const pinned = devices.map((d) => !!d.tierOverride);
  let P = 0;
  let Lo = 0;
  let Ty = 0;
  let Hi = 0;
  splits.forEach((r, i) => {
    if (pinned[i]) P += r.typical;
    else {
      Lo += r.low;
      Ty += r.typical;
      Hi += r.high;
    }
  });
  const out = (f: (r: Range) => number) => splits.map((r, i) => (pinned[i] ? r.typical : f(r)));

  if (P + Lo <= a && a <= P + Hi) {
    const t = Hi > Lo ? (a - P - Lo) / (Hi - Lo) : 0;
    return { kind: "t" as const, t, k: undefined, values: out((r) => r.low + t * (r.high - r.low)), raw: undefined };
  }
  if (Ty <= 0) return { kind: "k" as const, t: undefined, k: 1, values: out((r) => r.typical), raw: a > P ? Infinity : 0 };
  const raw = (a - P) / Ty;
  const k = clamp(raw, K_MIN, K_MAX);
  return { kind: "k" as const, t: undefined, k, values: out((r) => r.typical * k), raw };
}

export function calibrateGrid(
  devices: Device[],
  gridHours: GridHoursSetting,
  actual: ActualDaily,
  genHours: number | null = null,
  household: Household = "grid",
): { result: GridResult; values: number[] } {
  const hh = household;
  const H = genHours;
  const a = actual.value;
  const userG = gridHours.source === "user" && gridHours.value != null ? clamp(gridHours.value, 0, 24) : null;
  const E = (G: number) => gridEnergy(devices, G, H, hh);
  const E24 = E(24).typical;
  const base = {
    confidence: actual.confidence, actualDailyKwh: a, sources: actual.sources, spanDays: actual.spanDays,
    validPairs: actual.validPairs, fullSupplyKwh: E24,
  };
  const uncal = (G: number) => devices.map((d) => deviceSplit(d, G, H, hh).grid.typical);
  const hasGrid = devices.some((d) => sourcesOf(d, hh).includes("grid"));

  if (a == null || !hasGrid || E24 <= 0) {
    const G = userG ?? DEFAULT_GRID_HOURS;
    return {
      result: { ...base, status: "not_ready", mode: null, gridHoursUsed: G, coverage: null },
      values: uncal(G),
    };
  }

  const coverage = (G: number) => E(G).typical / a;

  if (userG == null) {
    // Mode A: infer light hours.
    const under = a > E24;
    const over = a < E(0).typical;
    if (under || over) {
      // Hours stay unknown: use the default and scale unpinned devices toward the meter, within limits.
      const G = DEFAULT_GRID_HOURS;
      const s = devices.map((d) => deviceSplit(d, G, H, hh).grid.typical);
      const P = s.reduce((t, v, i) => t + (devices[i].tierOverride ? v : 0), 0);
      const Ty = s.reduce((t, v, i) => t + (devices[i].tierOverride ? 0 : v), 0);
      const k = Ty > 0 ? clamp((a - P) / Ty, K_MIN, K_MAX) : 1;
      return {
        result: { ...base, status: under ? "mismatch_under" : "mismatch_over", mode: "infer_hours", gridHoursUsed: G, k, coverage: coverage(G) },
        values: s.map((v, i) => (devices[i].tierOverride ? v : v * k)),
      };
    }
    const G = solveGridHours(devices, a, "typical", H, hh)!;
    return {
      result: {
        ...base, status: "matched", mode: "infer_hours", gridHoursUsed: G,
        inferredGridHours: { value: G, range: hoursRange(devices, a, H, hh) }, coverage: coverage(G),
      },
      values: uncal(G),
    };
  }

  // Mode B: the user set their hours, so adjust the devices.
  const G = userG;
  const adj = adjust(devices, a, G, H, hh);
  let status: GridStatus = "matched";
  if (adj.kind === "k") status = adj.raw! > K_MAX ? "mismatch_under" : adj.raw! < K_MIN ? "mismatch_over" : "adjusted";
  const result: GridResult = { ...base, status, mode: "adjust_devices", gridHoursUsed: G, t: adj.t, k: adj.k, coverage: coverage(G) };
  // Sanity check: never change the user's hours, but suggest when the meter disagrees a lot.
  const g = solveGridHours(devices, a, "typical", H, hh);
  if (g != null && Math.abs(g - G) > Math.max(SUGGEST_DIFF_HOURS, SUGGEST_DIFF_FRACTION * G))
    result.suggestedGridHours = { value: g, range: hoursRange(devices, a, H, hh) };
  return { result, values: adj.values };
}

// ——— Generator (§B2.2, B5) ———

export interface GenActuals {
  actualLph: number | null; // litres per gen-hour
  /** Measured gen hours/day; needs ≥ 2 purchases. */
  genHoursPerDay: number | null;
  /** Latest purchase's hours as "one fill", for before H is measured. */
  roughGenHours: number | null;
  withHours: number;
  confidence: Confidence | null;
  nairaPerGenHour: number | null;
  nairaPerLitre: number | null;
}

type Purchase = Pick<FuelPurchase, "amountNaira" | "litres" | "hoursRun" | "purchasedAt">;

export function computeGenActuals(purchases: Purchase[]): GenActuals {
  const ok = purchases.filter((p) => p.litres > 0);
  const hrs = ok.filter((p) => (p.hoursRun ?? 0) > 0);
  const L = hrs.reduce((t, p) => t + p.litres, 0);
  const h = hrs.reduce((t, p) => t + p.hoursRun!, 0);
  const naira = hrs.reduce((t, p) => t + p.amountNaira, 0);

  // Each purchase's hours cover the days until the next purchase.
  const sorted = [...ok].sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
  let runH = 0;
  let spanD = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const days = daysBetween(localNoon(sorted[i].purchasedAt), localNoon(sorted[i + 1].purchasedAt));
    if (days > 0 && (sorted[i].hoursRun ?? 0) > 0) {
      runH += sorted[i].hoursRun!;
      spanD += days;
    }
  }
  const latest = [...hrs].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))[0];
  const n = hrs.length;
  const allL = ok.reduce((t, p) => t + p.litres, 0);
  return {
    actualLph: h > 0 ? L / h : null,
    genHoursPerDay: ok.length >= 2 && spanD > 0 ? Math.min(24, runH / spanD) : null,
    roughGenHours: latest ? Math.min(24, latest.hoursRun!) : null,
    withHours: n,
    confidence: !n ? null : n >= GEN_CONFIDENCE.solid ? "solid" : n >= GEN_CONFIDENCE.good ? "good" : "rough",
    nairaPerGenHour: h > 0 ? naira / h : null,
    nairaPerLitre: allL > 0 ? ok.reduce((t, p) => t + p.amountNaira, 0) / allL : null,
  };
}

export type GenSpec = { kwLow: number; kwHigh: number; fuelType: FuelType };
/** Gen capacity in kW: the middle of the resolved range. */
export const genKw = (g: GenSpec) => (g.kwLow + g.kwHigh) / 2;

/** Idle + slope fuel model: L/h at a given load. Tier picks efficient / typical / poor constants. */
export function burn(g: GenSpec, tier: TierKey = "typical") {
  const i = TIER_I[tier];
  const kw = genKw(g);
  const full = kw * L_PER_KWH_FULL[g.fuelType][i];
  return { kw, full, idle: full * IDLE_FRACTION[g.fuelType][i] };
}

export function predictedLph(g: GenSpec, loadKw: number, tier: TierKey = "typical") {
  const { kw, full, idle } = burn(g, tier);
  return idle + (full - idle) * clamp(loadKw / kw, 0, 1);
}

/** Compare fuel burn with the device load on the gen (§B5.3–B5.4). */
export function genVerdict(g: GenSpec, actualLph: number, deviceGenLoadKw: number) {
  const { kw, full, idle } = burn(g);
  const inferredLoadKw = clamp((kw * (actualLph - idle)) / (full - idle), 0, kw);
  let status: GenStatus;
  let k_gen = 1;
  let check: "too_low" | "too_high" | undefined;
  if (actualLph < burn(g, "low").idle) {
    status = "gen_data_check";
    check = "too_low";
  } else if (actualLph > burn(g, "high").full) {
    status = "gen_data_check";
    check = "too_high";
  } else if (deviceGenLoadKw <= 0) {
    status = inferredLoadKw > 0 ? "gen_mismatch_under" : "gen_matched";
  } else if (inferredLoadKw <= 0) {
    status = "gen_mismatch_over";
    k_gen = K_MIN;
  } else {
    const cov = deviceGenLoadKw / inferredLoadKw;
    k_gen = clamp(inferredLoadKw / deviceGenLoadKw, K_MIN, K_MAX);
    status = cov < GEN_COVERAGE_OK[0] ? "gen_mismatch_under" : cov > GEN_COVERAGE_OK[1] ? "gen_mismatch_over" : "gen_matched";
  }
  const coverage = inferredLoadKw > 0 ? deviceGenLoadKw / inferredLoadKw : null;
  return { status, k_gen, inferredLoadKw, coverage, check, kw };
}

export interface GenResult {
  status: GenStatus;
  confidence: Confidence | null;
  actualLph: number | null;
  genHoursPerDay: number | null;
  /** True while H comes from a single purchase. */
  genHoursRough: boolean;
  deviceGenLoadKw: number | null;
  inferredLoadKw: number | null;
  loadPercent: number | null;
  k_gen?: number;
  coverage: number | null;
  nairaPerKwh: number | null;
  /** What a healthy gen of this size would burn running the devices you've added. */
  predictedLph: number | null;
  genKwhPerDay: number | null;
  kw: number | null;
  check?: "too_low" | "too_high";
}

export function calibrateGen(
  devices: Device[],
  gen: GenSpec | null,
  actuals: GenActuals,
  gridHours: number,
  household: Household,
): { result: GenResult; values: number[] } {
  const H = actuals.genHoursPerDay ?? actuals.roughGenHours;
  const uncal = devices.map((d) => deviceSplit(d, gridHours, H ?? assumedGenHours(household), household).gen.typical);
  const empty: GenResult = {
    status: "not_ready", confidence: actuals.confidence, actualLph: actuals.actualLph, genHoursPerDay: H,
    genHoursRough: actuals.genHoursPerDay == null, deviceGenLoadKw: null, inferredLoadKw: null, loadPercent: null,
    coverage: null, nairaPerKwh: null, predictedLph: null, genKwhPerDay: null, kw: gen ? genKw(gen) : null,
  };
  if (!gen || actuals.actualLph == null || !H) return { result: empty, values: uncal };

  const deviceGenLoadKw = uncal.reduce((t, v) => t + v, 0) / H;
  const v = genVerdict(gen, actuals.actualLph, deviceGenLoadKw);
  const scale = v.status === "gen_data_check" ? 1 : v.k_gen;
  return {
    result: {
      ...empty,
      status: v.status,
      deviceGenLoadKw,
      inferredLoadKw: v.inferredLoadKw,
      loadPercent: v.inferredLoadKw / v.kw,
      k_gen: v.status === "gen_data_check" ? undefined : v.k_gen,
      coverage: v.coverage,
      nairaPerKwh: actuals.nairaPerGenHour != null && v.inferredLoadKw > 0 ? actuals.nairaPerGenHour / v.inferredLoadKw : null,
      predictedLph: predictedLph(gen, deviceGenLoadKw),
      genKwhPerDay: v.inferredLoadKw * H,
      check: v.check,
    },
    values: uncal.map((x) => x * scale),
  };
}

/** Gen hours to assume before any are logged: none in hybrid homes (grid covers what we know), a default for gen-only. */
export const assumedGenHours = (household: Household) => (household === "gen" ? DEFAULT_GRID_HOURS : 0);

// ——— Everything together (§B6–B7) ———

export interface MeterData {
  readings: MeterReading[];
  tokens: TokenLoad[];
  profile: MeterProfile;
  gridHours: GridHoursSetting;
  now: Date | string;
}

export interface GenData {
  generator: GenSpec | null;
  purchases: Purchase[];
}

export interface DeviceCalibration {
  uncalibrated: Range; // daily kWh, both sources
  uncalibratedGrid: Range;
  uncalibratedGen: Range;
  calibratedGrid: number;
  calibratedGen: number;
  ratioGrid: number;
  ratioGen: number;
}

export interface CalibrationResult {
  household: Household;
  grid?: GridResult;
  gen?: GenResult;
  /** Gen hours/day the split used (measured, rough, or assumed). */
  genHoursUsed: number | null;
  perDevice: Record<string, DeviceCalibration>;
  computedAt: string;
}

const ratio = (cal: number, uncal: number) => (uncal > 0 ? cal / uncal : 1);

export function calibrate(household: Household, devices: Device[], meter: MeterData, gen: GenData): CalibrationResult {
  const actuals = household === "grid" ? null : computeGenActuals(gen.purchases);
  // Measured H, else the latest purchase as one fill (rough).
  const H = actuals ? (actuals.genHoursPerDay ?? actuals.roughGenHours ?? assumedGenHours(household)) : null;

  // The grid solve already splits battery devices by G ÷ (G + H) at every candidate G, so the result is
  // self-consistent and the spec's one refinement pass would return the same numbers.
  let grid: { result: GridResult; values: number[] } | undefined;
  if (household !== "gen") {
    const actual = computeActualDaily(meter.readings, meter.tokens, meter.profile, meter.now);
    grid = calibrateGrid(devices, meter.gridHours, actual, H, household);
  }
  const G = grid?.result.gridHoursUsed ?? 0;
  const genOut = actuals ? calibrateGen(devices, gen.generator, actuals, G, household) : undefined;

  const perDevice: Record<string, DeviceCalibration> = {};
  devices.forEach((d, i) => {
    const s = deviceSplit(d, G, H, household);
    const cg = grid && grid.result.status !== "not_ready" ? grid.values[i] : s.grid.typical;
    const cn = genOut && genOut.result.status !== "not_ready" ? genOut.values[i] : s.gen.typical;
    perDevice[d.id] = {
      uncalibrated: addRange(s.grid, s.gen), uncalibratedGrid: s.grid, uncalibratedGen: s.gen,
      calibratedGrid: cg, calibratedGen: cn, ratioGrid: ratio(cg, s.grid.typical), ratioGen: ratio(cn, s.gen.typical),
    };
  });

  return {
    household, grid: grid?.result, gen: genOut?.result, genHoursUsed: H, perDevice,
    computedAt: new Date(typeof meter.now === "string" ? meter.now : meter.now.getTime()).toISOString(),
  };
}

// ——— Display (§B7–B9) ———

const READY_GRID: GridStatus[] = ["matched", "adjusted", "mismatch_under", "mismatch_over"];
const READY_GEN: GenStatus[] = ["gen_matched", "gen_mismatch_under", "gen_mismatch_over"];
export const gridReady = (r?: CalibrationResult | null) => !!r?.grid && READY_GRID.includes(r.grid.status);
export const genReady = (r?: CalibrationResult | null) => !!r?.gen && READY_GEN.includes(r.gen.status);

/** Calibrated value shown as a range: ± by confidence. */
export const spreadRange = (v: number, c: Confidence | null): Range => {
  const s = CONFIDENCE_SPREAD[c ?? "rough"];
  return { low: v * (1 - s), typical: v, high: v * (1 + s) };
};

/** A device's daily kWh per source: calibrated when switched on and ready, else the plain estimate. */
export function deviceDaily(d: Device, r: CalibrationResult | null, enabled: boolean, G: number, H: number | null): Split {
  const hh = r?.household ?? "grid";
  const c = r?.perDevice[d.id];
  if (!enabled || !r || !c) return deviceSplit(d, G, H, hh);
  return {
    grid: gridReady(r) ? spreadRange(c.calibratedGrid, r.grid!.confidence) : c.uncalibratedGrid,
    gen: genReady(r) ? spreadRange(c.calibratedGen, r.gen!.confidence) : c.uncalibratedGen,
  };
}

/** A device the calibration hasn't seen (new in the simulator): the same t / k / k_gen as everyone else. */
function newDeviceRatios(d: Device, s: Split, r: CalibrationResult) {
  let g = 1;
  const grid = r.grid;
  if (grid && gridReady(r) && !d.tierOverride) {
    if (grid.t != null && s.grid.typical > 0) g = (s.grid.low + grid.t * (s.grid.high - s.grid.low)) / s.grid.typical;
    else if (grid.k != null) g = grid.k;
  }
  return { grid: g, gen: genReady(r) ? (r.gen!.k_gen ?? 1) : 1 };
}

export type SimInput = { device: Device; baseId: string | null };

/**
 * Simulator values: recompute each row's plain estimate, then apply its stored ratios (new rows get the shared
 * t / k / k_gen). Never re-solves; hours changed in the simulator are what-ifs.
 */
export function simulateWithCalibration(
  rows: SimInput[],
  r: CalibrationResult | null,
  enabled: boolean,
  G: number,
  H: number | null,
  /** What-if household (e.g. "everything on the gen"); defaults to the calibrated one. */
  household?: Household,
): Split[] {
  const hh = household ?? r?.household ?? "grid";
  return rows.map(({ device, baseId }) => {
    const s = deviceSplit(device, G, H, hh);
    if (!enabled || !r) return s;
    const stored = baseId ? r.perDevice[baseId] : undefined;
    const k = stored ? { grid: stored.ratioGrid, gen: stored.ratioGen } : newDeviceRatios(device, s, r);
    return {
      grid: gridReady(r) ? spreadRange(s.grid.typical * k.grid, r.grid!.confidence) : s.grid,
      gen: genReady(r) ? spreadRange(s.gen.typical * k.gen, r.gen!.confidence) : s.gen,
    };
  });
}

export const sumSplits = (xs: Split[]): Split =>
  xs.reduce((a, x) => ({ grid: addRange(a.grid, x.grid), gen: addRange(a.gen, x.gen) }), ZERO_SPLIT);

/** "How we worked this out" lines for a device. */
export function calibrationNotes(d: Device, r: CalibrationResult | null, enabled: boolean): string[] {
  const c = r?.perDevice[d.id];
  if (!enabled || !r || !c) return [];
  const out: string[] = [];
  const x = (n: number) => `×${Math.round(n * 100) / 100}`;
  const g = r.grid;
  if (g && gridReady(r) && c.uncalibratedGrid.typical > 0) {
    if (d.tierOverride) out.push("You pinned this one, so matching to your meter leaves it as is.");
    else if (g.t != null) out.push("Positioned within its typical range to match your meter.");
    else if (g.k != null && Math.abs(c.ratioGrid - 1) > 0.005) out.push(`Adjusted to match your meter (${x(c.ratioGrid)}).`);
    else if (g.mode === "infer_hours") out.push("Matched to your meter by working out your light hours.");
  }
  if (genReady(r) && c.uncalibratedGen.typical > 0 && Math.abs(c.ratioGen - 1) > 0.005)
    out.push(`Adjusted to match your fuel use (${x(c.ratioGen)}).`);
  return out;
}

// ——— Prompts (§B4.3, B5.3–B5.4, B6) ———

export const GRID_CULPRITS = ["fridge or freezer", "pressing iron", "pumping machine", "water heater", "AC", "devices left on"];

export function gridPrompt(status: GridStatus): string | null {
  switch (status) {
    case "mismatch_under":
      return "Your meter shows more usage than your devices explain. Something may be missing or running longer.";
    case "mismatch_over":
      return "Your devices should use more than your meter shows. Some may run fewer hours, run on generator, or charge elsewhere.";
    case "not_ready":
      return "Add a meter reading to match your real usage.";
    default:
      return null;
  }
}

export function genPrompt(g: Pick<GenResult, "status" | "check">): string | null {
  switch (g.status) {
    case "gen_mismatch_under":
      return "More devices may run on your gen than you've added — or your gen may need servicing (dirty filter, old plugs make gens burn extra fuel).";
    case "gen_mismatch_over":
      return "Some devices may not run the whole time the gen is on.";
    case "gen_data_check":
      return g.check === "too_high"
        ? "That's more fuel than this size of gen can burn. Check gen size, litres or hours."
        : "Double-check litres or hours for your last fuel purchase.";
    case "not_ready":
      return "Log a fuel purchase with hours to match your gen.";
    default:
      return null;
  }
}
