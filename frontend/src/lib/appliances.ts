import { hrsLabel, num, trimN, uid } from "./format";
import { CATEGORIES, LAGOS_FLAT, PRESETS, type CategoryId, type Preset, type UsageType } from "./presets";
import type { Entry } from "./spend";

export type Tier = "low" | "typical" | "high" | "custom";

export type Device = {
  id: string;
  presetId: string | null;
  name: string;
  cat: CategoryId;
  icon: string;
  type: UsageType;
  tiers: [number, number, number] | null; // W (or Wh/charge) low/typical/high; null for custom
  tier: Tier;
  custom: number | null; // W or Wh when tier = custom
  hours: number; // 0–24 (steady/cycling)
  charges: number; // per day (charging)
  duty: number; // % (cycling)
  qty: number;
  help?: string | null;
};

/** Editable fields hold raw input text while the user types. */
export type Editable<T> = Omit<T, "hours" | "custom" | "qty"> & {
  hours: number | string;
  custom: number | string | null;
  qty: number | string;
};

export type SimRow = Editable<Device> & { key: string; baseId: string | null; on: boolean };

export type Draft = Editable<Device> & {
  mode: "add" | "edit";
  target: "home" | "sim";
  fromPicker: boolean;
  adv: boolean;
  isCustom: boolean;
};

type Calc = Editable<Device>;

export const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<CategoryId, string>;
export const CAT_ORDER = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i])) as Record<CategoryId, number>;
export const PRESET_BY = Object.fromEntries(PRESETS.map((p) => [p.id, p])) as Record<string, Preset>;
const TIER_IDX = { low: 0, typical: 1, high: 2 } as const;

export const fromPreset = (p: Preset, qty = 1): Device => ({
  id: uid(),
  presetId: p.id,
  name: p.name,
  cat: p.cat,
  icon: p.icon,
  type: p.type,
  tiers: [...p.tiers],
  tier: "typical",
  custom: null,
  hours: p.type === "charging" ? 0 : p.use,
  charges: p.type === "charging" ? p.use : 0,
  duty: p.duty || 100,
  qty,
  help: p.help ?? null,
});

export const lagosFlat = () => LAGOS_FLAT.map(([id, q]) => fromPreset(PRESET_BY[id], q));

export const initSim = (devs: Device[]): SimRow[] =>
  devs.map((d) => ({ ...d, key: "b-" + d.id, baseId: d.id, on: true }));

export const watts = (d: Calc, t: Tier = d.tier) =>
  t === "custom" || !d.tiers ? num(d.custom) : d.tiers[TIER_IDX[t]];

export const clampH = (v: number) => Math.min(24, Math.max(0, v));

/** kWh per day for one device line (qty included). */
export const daily = (d: Calc, t: Tier = d.tier) => {
  const w = watts(d, t);
  const q = Math.max(0, num(d.qty));
  if (d.type === "charging") return (w * num(d.charges) * q) / 1000;
  const h = clampH(num(d.hours));
  return (w * h * (d.type === "cycling" ? num(d.duty) / 100 : 1) * q) / 1000;
};

export type Trio = { lo: number; typ: number; hi: number };

/** Low/typical/high daily kWh. Custom wattage is fixed across all three. */
export const trio = (d: Calc): Trio => {
  const fixed = d.tier === "custom" || !d.tiers;
  return { lo: daily(d, fixed ? "custom" : "low"), typ: daily(d), hi: daily(d, fixed ? "custom" : "high") };
};

export const sumTrio = (arr: Calc[]): Trio =>
  arr.reduce(
    (a, d) => {
      const t = trio(d);
      return { lo: a.lo + t.lo, typ: a.typ + t.typ, hi: a.hi + t.hi };
    },
    { lo: 0, typ: 0, hi: 0 },
  );

export const usageSummary = (d: Calc) =>
  d.type === "charging"
    ? `${trimN(num(d.charges))} charge${num(d.charges) === 1 ? "" : "s"}/day`
    : d.type === "cycling"
      ? `${hrsLabel(num(d.hours))} · ~${num(d.duty)}% duty`
      : `${hrsLabel(num(d.hours))}/day`;

export const chargesUp = (c: number) => Math.floor(c / 0.5 + 1e-9) * 0.5 + 0.5;
export const chargesDown = (c: number) => Math.max(0, Math.ceil(c / 0.5 - 1e-9) * 0.5 - 0.5);

/** Supply warning: steady/cycling devices set to run longer than grid hours. */
export const supplyWarning = (d: Calc, gridHours: number) =>
  d.type !== "charging" && num(d.hours) > gridHours
    ? `You get about ${gridHours}h of light a day — this is set to ${trimN(num(d.hours))}h.`
    : "";

/** Normalise an editable row/draft back into a stored Device. */
export function toDevice(d: Editable<Device> & Partial<Draft> & Partial<SimRow>): Device {
  const custom = num(d.custom);
  return {
    id: d.id,
    presetId: d.presetId,
    name: (d.name || "").trim() || (d.isCustom ? "Custom device" : d.name),
    cat: d.cat,
    icon: d.icon,
    type: d.type,
    tiers: d.tiers,
    tier: d.tier,
    custom: custom || null,
    hours: clampH(num(d.hours)),
    charges: num(d.charges),
    duty: Math.min(100, Math.max(0, num(d.duty))),
    qty: Math.max(1, Math.round(num(d.qty))),
    help: d.help ?? null,
  };
}

/** Has a sim row drifted from its My Home baseline? */
export function isModified(r: SimRow, home: Device[]) {
  if (!r.baseId) return true;
  const b = home.find((x) => x.id === r.baseId);
  if (!b) return true;
  if (!r.on || r.tier !== b.tier) return true;
  return (["qty", "hours", "charges", "custom", "duty"] as const).some((f) => num(r[f]) !== num(b[f]));
}

export type Tariff = { value: number; source: string };

/** Average ₦/kWh of the last 3 logged tokens that have units. */
export function derivedTariff(entries: Entry[]): Tariff | null {
  const toks = entries
    .filter((e) => e.type === "token" && (e.quantity ?? 0) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 3);
  if (!toks.length) return null;
  const a = toks.reduce((t, e) => t + e.amount_naira, 0);
  const q = toks.reduce((t, e) => t + (e.quantity ?? 0), 0);
  return { value: a / q, source: `Based on your last ${toks.length} token${toks.length > 1 ? "s" : ""}` };
}
