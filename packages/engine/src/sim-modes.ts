// Simulator tabs that involve a generator: turn per-device kWh splits into fuel and ₦.
// Fuel uses the calibration burn model (§B5.1): a fixed idle burn for every gen hour, plus litres per kWh of load.
// Pure functions only; .ts imports so `node --test` can run them.

import { burn, type GenSpec, type Split } from "./calibration.ts";
import { addRange, scaleRange, ZERO, type Range } from "./energy.ts";

export type SimMode = "prepaid" | "hybrid" | "gen";

/** Idle L/h and the extra litres per kWh delivered (typical constants). */
export function fuelModel(gen: GenSpec) {
  const { kw, full, idle } = burn(gen);
  return { kw, idleLph: idle, litresPerKwh: (full - idle) / kw };
}

export type Prices = { tariff: number | null; nairaPerLitre: number | null };

export interface ModeRow {
  units: Range; // kWh/day, both sources
  grid: Range;
  gen: Range;
  /** This device's share of the fuel: the load-dependent part only (idle burn is the gen's, not any one device's). */
  litres: Range;
  naira: Range | null; // ₦/day; null when a side it uses has no price
}

export interface ModeTotals {
  gridKwh: Range;
  genKwh: Range;
  /** Fuel a day, including idle burn. */
  litres: Range;
  idleLitres: number;
  gridNaira: Range | null;
  genNaira: Range | null;
  naira: Range | null;
  /** Average load while the gen runs, and its size. */
  loadKw: number | null;
  kw: number | null;
  overload: boolean;
}

const priced = (r: Range, price: number | null) => (r.typical > 0 ? (price != null ? scaleRange(r, price) : null) : ZERO);
const plus = (a: Range | null, b: Range | null) => (a && b ? addRange(a, b) : null);

/** Costs per device and in total. `on` marks rows that count toward the totals; H = gen hours a day. */
export function costMode(splits: Split[], on: boolean[], H: number, gen: GenSpec | null, prices: Prices) {
  const f = gen ? fuelModel(gen) : null;
  const litresOf = (genKwh: Range) => (f ? scaleRange(genKwh, f.litresPerKwh) : ZERO);

  const rows: ModeRow[] = splits.map((s) => {
    const litres = litresOf(s.gen);
    return {
      units: addRange(s.grid, s.gen), grid: s.grid, gen: s.gen, litres,
      naira: plus(priced(s.grid, prices.tariff), priced(litres, prices.nairaPerLitre)),
    };
  });

  const counted = splits.filter((_, i) => on[i]);
  const gridKwh = counted.reduce((a, s) => addRange(a, s.grid), ZERO);
  const genKwh = counted.reduce((a, s) => addRange(a, s.gen), ZERO);
  // The gen only runs if something is on it.
  const idleLitres = f && H > 0 && genKwh.typical > 0 ? f.idleLph * H : 0;
  const litres = addRange({ low: idleLitres, typical: idleLitres, high: idleLitres }, litresOf(genKwh));
  const gridNaira = priced(gridKwh, prices.tariff);
  const genNaira = priced(litres, prices.nairaPerLitre);
  const loadKw = f && H > 0 ? genKwh.typical / H : null;

  const totals: ModeTotals = {
    gridKwh, genKwh, litres, idleLitres, gridNaira, genNaira, naira: plus(gridNaira, genNaira),
    loadKw, kw: f?.kw ?? null, overload: !!f && loadKw != null && loadKw > f.kw,
  };
  return { rows, totals };
}

/** Days a quantity lasts at a daily rate (Infinity when nothing is used). */
export const lastsDays = (amount: number, perDay: number) => (perDay > 0 ? amount / perDay : Infinity);
