// Glue between saved app state and the calibration engine, plus the units/₦ view the screens share.
import { supplyWarning } from "./appliances";
import {
  calibrate, computeGenActuals, householdOf, simulateWithCalibration, sourcesOf, type GenSpec, type CalibrationResult, type Household, type SimInput, type Split,
} from "./calibration";
import { addRange, type Device, type Range } from "./energy";
import {
  genSummary, NOT_SURE_TYPE, resolveKw, sizeLabel, type FuelPurchase, type GeneratorProfile,
} from "./generator";
import { tokensFromEntries, type MeterReading, type MeterState } from "./meter";
import { costMode } from "./sim-modes";
import { gridHoursSetting, type Entry, type Settings } from "./spend";

export type HomeState = {
  settings: Settings;
  devices: Device[];
  entries: Entry[];
  readings: MeterReading[];
  meter: MeterState;
  generator: GeneratorProfile | null;
  purchases: FuelPurchase[];
};

export function calibrateHome(s: HomeState, now: Date = new Date()): CalibrationResult {
  return calibrate(
    householdOf(s.settings.source),
    s.devices,
    {
      readings: s.readings, tokens: tokensFromEntries(s.entries), profile: s.meter.profile,
      gridHours: gridHoursSetting(s.settings), now,
    },
    { generator: s.generator, purchases: s.purchases },
  );
}

/** Persist what the meter says about light hours (only when the user hasn't set them). */
export function inferredHoursPatch(s: Settings, r: CalibrationResult): Partial<Settings> | null {
  const g = r.grid;
  if (!g || s.gridHoursSource === "user" || g.mode !== "infer_hours") return null;
  if (g.inferredGridHours) {
    const v = Math.round(g.inferredGridHours.value * 10) / 10;
    const range = g.inferredGridHours.range.map((x) => Math.round(x * 10) / 10) as [number, number];
    if (s.gridHoursSource === "inferred" && s.gridHours === v && s.gridHoursRange?.[0] === range[0] && s.gridHoursRange?.[1] === range[1])
      return null;
    return { gridHours: v, gridHoursSource: "inferred", gridHoursRange: range };
  }
  // Mismatch: hours stay unknown.
  return s.gridHoursSource === "none" ? null : { gridHoursSource: "none", gridHoursRange: null };
}

/** Everything a screen needs to turn devices into units and ₦. */
export type Calib = {
  /** null = plain estimates (e.g. a prepaid what-if for a gen-only home). */
  result: CalibrationResult | null;
  enabled: boolean;
  household: Household;
  /** Light and gen hours a day the numbers use. */
  G: number;
  H: number | null;
  /** ₦/kWh from the meter and from the gen. */
  tariff: number | null;
  genRate: number | null;
};

export function calibContext(s: HomeState, result: CalibrationResult, tariff: number | null): Calib {
  const sum = s.generator ? genSummary(s.generator, s.purchases) : null;
  return {
    result,
    enabled: s.settings.calibrate,
    household: result.household,
    G: result.grid?.gridHoursUsed ?? 0,
    H: result.genHoursUsed,
    tariff,
    genRate: (s.settings.calibrate ? result.gen?.nairaPerKwh : null) ?? (sum ? (sum.perKwhLow + sum.perKwhHigh) / 2 : null),
  };
}

export const splitsOf = (c: Calib, rows: SimInput[], hours?: { G: number; H: number | null }, household?: Household): Split[] =>
  simulateWithCalibration(rows, c.result, c.enabled, hours?.G ?? c.G, hours?.H ?? c.H, household);

export const homeSplits = (c: Calib, devices: Device[]) => splitsOf(c, devices.map((d) => ({ device: d, baseId: d.id })));

export const unitsOf = (s: Split): Range => addRange(s.grid, s.gen);

export type SimFuel = ReturnType<typeof simFuel>;

/**
 * ₦ and fuel a day for devices as My Home runs them: light at the tariff, the gen side through the fuel model.
 * The gen's idle burn is counted once in the totals, not shared out to devices. Same maths as the simulator's gen tabs.
 */
export const priceHome = (c: Calib, fuel: SimFuel, splits: Split[]) =>
  costMode(splits, splits.map(() => true), c.H ?? 0, c.household === "grid" ? null : fuel.spec, {
    tariff: c.tariff,
    nairaPerLitre: fuel.info.nairaPerLitre,
  });

export const toTrio = (r: Range) => ({ lo: r.low, typ: r.typical, hi: r.high });

const h1 = (n: number) => String(Math.round(n * 2) / 2);

/** Mains devices set to run longer than their power sources are on. */
export function supplyNote(d: Device, c: Pick<Calib, "household" | "G" | "H">): string {
  if (d.usage.profile !== "steady" && d.usage.profile !== "cycling") return "";
  const h = d.usage.hoursPerDay ?? 0;
  const src = sourcesOf(d, c.household);
  if (!src.includes("gen")) return supplyWarning(d, Math.round(c.G * 2) / 2);
  const gen = c.H ?? 0;
  if (!src.includes("grid"))
    return gen && h > gen ? `Your gen runs about ${h1(gen)}h a day; this is set to ${h1(h)}h.` : "";
  return gen && h > c.G + gen ? `You get about ${h1(c.G)}h of light and ${h1(gen)}h of gen a day; this is set to ${h1(h)}h.` : "";
}

/** The gen the simulator's gen tabs use: the home's, or a typical small petrol one, priced from fuel logs. */
export function simFuel(generator: GeneratorProfile | null, purchases: FuelPurchase[], entries: Entry[]) {
  const spec: GenSpec = generator ?? { ...resolveKw({ sizeSource: "not_sure", typeId: NOT_SURE_TYPE }), fuelType: "petrol" };
  const fromPurchases = computeGenActuals(purchases).nairaPerLitre;
  const logged = entries.filter((e) => e.type === "fuel" && (e.quantity ?? 0) > 0);
  const litres = logged.reduce((t, e) => t + e.quantity!, 0);
  const nairaPerLitre = fromPurchases ?? (litres ? logged.reduce((t, e) => t + e.amount_naira, 0) / litres : null);
  return {
    spec,
    info: {
      label: generator ? `${sizeLabel(generator)} ${generator.fuelType}` : "typical small petrol · assumed",
      assumed: !generator,
      nairaPerLitre,
      priceSource: nairaPerLitre != null ? "from your fuel logs" : null,
    },
  };
}
