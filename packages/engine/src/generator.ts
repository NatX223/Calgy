// Generator costs from real fuel purchases. All tunable numbers live at the top of this file.
import { parseIso, todayIso, trim } from "./format";

export type GenSizeSource = "card" | "entered" | "not_sure";
export type FuelType = "petrol" | "diesel";
export type RatingUnit = "kVA" | "kW";

export interface GeneratorProfile {
  id: string;
  sizeSource: GenSizeSource;
  typeId?: string; // from GEN_TYPES when card / not_sure
  ratingValue?: number; // when entered
  ratingUnit?: RatingUnit;
  kwLow: number; // resolved capacity range in kW
  kwHigh: number;
  fuelType: FuelType;
  createdAt: string; // ISO
}

export interface FuelPurchase {
  id: string; // same id as the matching fuel Entry in the spend log
  generatorId: string;
  amountNaira: number;
  litres: number;
  hoursRun: number | null; // hours this purchase ran the gen (required at onboarding)
  purchasedAt: string; // YYYY-MM-DD (user-entered)
  source: "onboarding" | "log";
  createdAt: string;
}

export type GenType = {
  id: string;
  label: string;
  kvaLow: number;
  kvaHigh: number;
  fuel: FuelType;
  burnLow: number; // L/hour at light–moderate load; sanity checks only
  burnHigh: number;
};

// ── Config ────────────────────────────────────────────────────────────────

export const GEN_TYPES: GenType[] = [
  { id: "tiny_petrol", label: '"I better pass my neighbour"', kvaLow: 0.65, kvaHigh: 1, fuel: "petrol", burnLow: 0.3, burnHigh: 0.5 },
  { id: "small_petrol", label: "Small portable petrol", kvaLow: 1.5, kvaHigh: 2.5, fuel: "petrol", burnLow: 0.6, burnHigh: 1.0 },
  { id: "medium_petrol", label: "Medium petrol (key start)", kvaLow: 3.5, kvaHigh: 5, fuel: "petrol", burnLow: 1.0, burnHigh: 1.8 },
  { id: "large_petrol", label: "Large petrol", kvaLow: 6.5, kvaHigh: 8, fuel: "petrol", burnLow: 1.8, burnHigh: 3.0 },
  { id: "diesel_home", label: "Diesel (home/office)", kvaLow: 10, kvaHigh: 20, fuel: "diesel", burnLow: 1.5, burnHigh: 3.5 },
];

export const NOT_SURE_TYPE = "small_petrol";
export const KW_PER_KVA = 0.8;
export const KWH_PER_LITRE: Record<FuelType, [number, number]> = { petrol: [1.5, 2.5], diesel: [2.5, 3.5] };
export const MAX_KVA = 2000;
export const PRICE_PER_LITRE_RANGE: [number, number] = [300, 3000];
/** Litres/hour below low × burnLow or above high × burnHigh is flagged. */
export const BURN_MULTIPLIERS = { low: 0.5, high: 2 };
/** Purchases with hours needed before we stop calling the numbers rough. */
export const SOLID_AFTER = 3;
export const HOUR_CHIPS = [2, 4, 6, 8, 12, 24];

/** One generator per home for now. */
export const GEN_ID = "gen-home";
/** Fixed id for the fuel purchase captured during onboarding when it isn't already in the log. */
export const OB_FUEL_ID = "ob-fuel";

// ── Rounding ──────────────────────────────────────────────────────────────

export const r10 = (n: number) => Math.round(n / 10) * 10;
export const r100 = (n: number) => Math.round(n / 100) * 100;
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const fmt1 = (n: number) => trim(r1(n).toFixed(1));
const ngn = (n: number) => "₦" + n.toLocaleString("en-NG");
export const naira10 = (n: number) => ngn(r10(n));
export const naira100 = (n: number) => ngn(r100(n));

// ── Size ──────────────────────────────────────────────────────────────────

export const genType = (id?: string) => GEN_TYPES.find((t) => t.id === id);

const toKva = (value: number, unit: RatingUnit) => (unit === "kVA" ? value : value / KW_PER_KVA);

/** Capacity in kW, as a range. */
export function resolveKw(p: Pick<GeneratorProfile, "sizeSource" | "typeId" | "ratingValue" | "ratingUnit">) {
  if (p.sizeSource === "entered" && p.ratingValue) {
    const kw = p.ratingUnit === "kW" ? p.ratingValue : p.ratingValue * KW_PER_KVA;
    return { kwLow: kw, kwHigh: kw };
  }
  const t = genType(p.typeId) ?? genType(NOT_SURE_TYPE)!;
  return { kwLow: t.kvaLow * KW_PER_KVA, kwHigh: t.kvaHigh * KW_PER_KVA };
}

/** The GEN_TYPE a profile belongs to: its own card, or the one whose kVA range holds (or is nearest) the rating. */
export function typeForProfile(p: Pick<GeneratorProfile, "sizeSource" | "typeId" | "ratingValue" | "ratingUnit">) {
  if (p.sizeSource !== "entered" || !p.ratingValue) return genType(p.typeId) ?? genType(NOT_SURE_TYPE)!;
  const kva = toKva(p.ratingValue, p.ratingUnit ?? "kVA");
  const gap = (t: GenType) => (kva < t.kvaLow ? t.kvaLow - kva : kva > t.kvaHigh ? kva - t.kvaHigh : 0);
  return GEN_TYPES.reduce((best, t) => (gap(t) < gap(best) ? t : best));
}

/** "Small portable petrol · ~1.5–2.5kVA" or "5 kVA". */
export function sizeLabel(p: GeneratorProfile) {
  if (p.sizeSource === "entered" && p.ratingValue) return `${trim(String(p.ratingValue))} ${p.ratingUnit ?? "kVA"}`;
  const t = typeForProfile(p);
  return `${p.sizeSource === "not_sure" ? "Not sure" : t.label} · ~${t.kvaLow}–${t.kvaHigh}kVA`;
}

// ── Per-purchase maths ────────────────────────────────────────────────────

export type PurchaseStats = {
  pricePerLitre: number;
  litresPerHour: number | null;
  nairaPerHour: number | null;
  kwhLow: number;
  kwhHigh: number;
  perKwhLow: number;
  perKwhHigh: number;
  capped: boolean;
};

export function purchaseStats(p: FuelPurchase, gen: GeneratorProfile): PurchaseStats {
  const [eLow, eHigh] = KWH_PER_LITRE[gen.fuelType];
  const cap = p.hoursRun ? gen.kwHigh * p.hoursRun : Infinity;
  const rawLow = p.litres * eLow;
  const rawHigh = p.litres * eHigh;
  const kwhLow = Math.min(rawLow, cap);
  const kwhHigh = Math.min(rawHigh, cap);
  return {
    pricePerLitre: p.amountNaira / p.litres,
    litresPerHour: p.hoursRun ? p.litres / p.hoursRun : null,
    nairaPerHour: p.hoursRun ? p.amountNaira / p.hoursRun : null,
    kwhLow,
    kwhHigh,
    perKwhLow: p.amountNaira / kwhHigh,
    perKwhHigh: p.amountNaira / kwhLow,
    capped: rawLow > cap || rawHigh > cap,
  };
}

// ── Across purchases ──────────────────────────────────────────────────────

const avg = (a: number[]) => (a.length ? a.reduce((t, n) => t + n, 0) / a.length : null);

export type GenSummary = {
  count: number;
  withHours: number;
  rough: boolean;
  pricePerLitre: number;
  litresPerHour: number | null;
  nairaPerHour: number | null;
  perKwhLow: number;
  perKwhHigh: number;
  capped: boolean;
  monthly: { spend: number; hours: number | null; intervalDays: number } | null;
};

/** Days between two YYYY-MM-DD dates. */
const daysBetween = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 864e5);

/** Simple averages across every purchase (recency weighting comes later). */
export function genSummary(gen: GeneratorProfile, purchases: FuelPurchase[]): GenSummary | null {
  if (!purchases.length) return null;
  const stats = purchases.map((p) => purchaseStats(p, gen));
  const hourly = stats.filter((s) => s.nairaPerHour != null);
  const withHours = purchases.filter((p) => p.hoursRun);

  let monthly: GenSummary["monthly"] = null;
  if (purchases.length >= 2) {
    const dates = purchases.map((p) => p.purchasedAt).sort();
    // Mean of consecutive gaps = total span ÷ number of gaps.
    const interval = daysBetween(dates[0], dates[dates.length - 1]) / (dates.length - 1);
    if (interval > 0) {
      const avgHours = avg(withHours.map((p) => p.hoursRun!));
      monthly = {
        spend: (avg(purchases.map((p) => p.amountNaira))! / interval) * 30,
        hours: avgHours == null ? null : (avgHours / interval) * 30,
        intervalDays: interval,
      };
    }
  }

  return {
    count: purchases.length,
    withHours: withHours.length,
    rough: withHours.length < SOLID_AFTER,
    pricePerLitre: avg(stats.map((s) => s.pricePerLitre))!,
    litresPerHour: avg(hourly.map((s) => s.litresPerHour!)),
    nairaPerHour: avg(hourly.map((s) => s.nairaPerHour!)),
    perKwhLow: avg(stats.map((s) => s.perKwhLow))!,
    perKwhHigh: avg(stats.map((s) => s.perKwhHigh))!,
    capped: stats.some((s) => s.capped),
    monthly,
  };
}

// ── Validation & sanity checks ────────────────────────────────────────────

/** Hard error for an entered rating, or null when fine / empty. */
export function ratingError(value: number, unit: RatingUnit) {
  if (!value) return null;
  return toKva(value, unit) > MAX_KVA ? `That's bigger than a home gen gets (max ${MAX_KVA.toLocaleString("en-NG")} kVA).` : null;
}

export const dateError = (d: string) =>
  !d ? "Pick a date." : d > todayIso() ? "That date is in the future." : null;

export const hoursError = (h: number) => (h > 0 && Math.round(h * 2) !== h * 2 ? "Use whole or half hours." : null);

export function priceWarning(amount: number, litres: number) {
  if (!amount || !litres) return null;
  const ppl = amount / litres;
  const [lo, hi] = PRICE_PER_LITRE_RANGE;
  return ppl < lo || ppl > hi ? "That price per litre looks unusual. Double-check the amount and litres?" : null;
}

export function burnWarning(litres: number, hours: number, type: GenType) {
  if (!litres || !hours) return null;
  const lph = litres / hours;
  return lph < BURN_MULTIPLIERS.low * type.burnLow || lph > BURN_MULTIPLIERS.high * type.burnHigh
    ? "That's unusual for this size of gen. Double-check the hours or litres?"
    : null;
}

// ── Backups ───────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate a generator + purchases from an imported backup; purchases must match an imported fuel entry. */
export function cleanImportedGen(rawGen: unknown, rawPurchases: unknown, fuelIds: Set<string>) {
  const g = rawGen as Partial<GeneratorProfile> | null;
  if (!g || typeof g !== "object" || !isNum(g.kwLow) || !isNum(g.kwHigh) || (g.fuelType !== "petrol" && g.fuelType !== "diesel"))
    return { generator: null, purchases: [] as FuelPurchase[] };
  const generator: GeneratorProfile = {
    id: GEN_ID,
    sizeSource: g.sizeSource === "card" || g.sizeSource === "entered" ? g.sizeSource : "not_sure",
    typeId: typeof g.typeId === "string" ? g.typeId : undefined,
    ratingValue: isNum(g.ratingValue) ? g.ratingValue : undefined,
    ratingUnit: g.ratingUnit === "kW" ? "kW" : g.ratingUnit === "kVA" ? "kVA" : undefined,
    kwLow: g.kwLow,
    kwHigh: g.kwHigh,
    fuelType: g.fuelType,
    createdAt: typeof g.createdAt === "string" ? g.createdAt : new Date().toISOString(),
  };
  const purchases = (Array.isArray(rawPurchases) ? rawPurchases : [])
    .filter((p): p is FuelPurchase => {
      const r = p as Partial<FuelPurchase> | null;
      return !!r && typeof r.id === "string" && fuelIds.has(r.id) && isNum(r.amountNaira) && r.amountNaira > 0 &&
        isNum(r.litres) && r.litres > 0 && typeof r.purchasedAt === "string";
    })
    .map((p) => ({
      ...p,
      generatorId: GEN_ID,
      hoursRun: isNum(p.hoursRun) && p.hoursRun > 0 ? p.hoursRun : null,
      source: p.source === "onboarding" ? ("onboarding" as const) : ("log" as const),
    }));
  return { generator, purchases };
}
