// Glue between the device energy engine and the My Home / Simulator / add-device screens.
import {
  adapterMaxW, dailyWh, LIMITS, outOfRange, resolveDraw, type Device, type DeviceRating, type DeviceUsage,
  type LimitKey, type TierKey,
} from "./energy";
import { BTU_PER_HP_AC, DEFAULT_NOMINAL_V, MICROWAVE_OUTPUT_TO_INPUT } from "./energy-constants";
import { hrsLabel, num, trimN, uid } from "./format";
import { meterTariff, tokensFromEntries } from "./meter";
import {
  CATEGORIES, LAGOS_FLAT, PRESET_BY, type CategoryId, type InputMethod, type Preset, type UsageProfile,
} from "./presets";
import type { Entry } from "./spend";

export type { Device, DeviceRating, DeviceUsage, TierKey } from "./energy";
export { PRESET_BY } from "./presets";

export const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<CategoryId, string>;
export const CAT_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon])) as Record<CategoryId, string>;
export const CAT_ORDER = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i])) as Record<CategoryId, number>;

const now = () => new Date().toISOString();

export const presetUsage = (p: Preset): DeviceUsage => ({
  profile: p.profile,
  hoursPerDay: p.profile === "steady" || p.profile === "cycling" ? (p.hours ?? 0) : undefined,
  dutyPercent: p.profile === "cycling" ? (p.duty ?? 100) : undefined,
  chargesPerDay: p.profile === "charges" ? (p.charges ?? 1) : undefined,
  workload: p.workload,
  inverter: p.inverter,
});

export const fromPreset = (p: Preset, qty = 1, usage: Partial<DeviceUsage> = {}): Device => ({
  id: uid(),
  presetId: p.id,
  name: p.name,
  category: p.cat,
  icon: p.icon,
  quantity: qty,
  rating: { method: "preset_only" },
  usage: { ...presetUsage(p), ...usage },
  createdAt: now(),
  updatedAt: now(),
});

export const lagosFlat = () => LAGOS_FLAT.map(([id, q, u]) => fromPreset(PRESET_BY[id], q, u));

// ——— Energy per device (kWh/day) ———

export type Trio = { lo: number; typ: number; hi: number };

/** Low/typical/high kWh a day. `g` = grid hours (prepaid); null = full supply. */
export const trio = (d: Device, g: number | null): Trio => {
  const r = dailyWh(d, g);
  return { lo: r.low / 1000, typ: r.typical / 1000, hi: r.high / 1000 };
};

export const sumTrio = (arr: Device[], g: number | null): Trio =>
  arr.reduce(
    (a, d) => {
      const t = trio(d, g);
      return { lo: a.lo + t.lo, typ: a.typ + t.typ, hi: a.hi + t.hi };
    },
    { lo: 0, typ: 0, hi: 0 },
  );

export const isMains = (d: Device) => d.usage.profile === "steady" || d.usage.profile === "cycling";
export const fromLabel = (d: Device) => d.rating.method !== "preset_only";

/** Unit for the resolved draw: Wh per charge for charging devices, else W. */
export const drawUnit = (d: Device) => (d.usage.profile === "charges" ? "Wh" : "W");
export const fmtDraw = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-NG") : trimN(Math.round(n * 10) / 10));

export function usageSummary(d: Device) {
  const u = d.usage;
  switch (u.profile) {
    case "steady":
      return `${hrsLabel(u.hoursPerDay ?? 0)}/day`;
    case "cycling": {
      const p = d.presetId ? PRESET_BY[d.presetId] : undefined;
      if (d.rating.method === "kwh_year" || (d.rating.method === "preset_only" && p?.method === "kwh_year")) {
        const k = d.rating.kwhPerYear ?? p?.label.kwhPerYear ?? 0;
        return `Energy label · ${d.rating.method === "preset_only" ? "~" : ""}${k.toLocaleString("en-NG")} kWh/yr`;
      }
      return `${hrsLabel(u.hoursPerDay ?? 0)} · ~${u.dutyPercent ?? 100}% running`;
    }
    case "charges": {
      const c = u.chargesPerDay ?? 0;
      return `${trimN(c)} charge${c === 1 ? "" : "s"}/day`;
    }
    case "always_on_battery":
      return "Always on · battery backup";
  }
}

const step = (c: number, dir: 1 | -1) => Math.min(10, Math.max(0, Math.round((c + dir * 0.1) * 10) / 10));
export const chargesUp = (c: number) => step(c, 1);
export const chargesDown = (c: number) => step(c, -1);

/** Mains-only devices set to run longer than grid hours. */
export const supplyWarning = (d: Device, gridHours: number) =>
  isMains(d) && (d.usage.hoursPerDay ?? 0) > gridHours
    ? `You get about ${gridHours}h of light a day; this is set to ${trimN(d.usage.hoursPerDay ?? 0)}h.`
    : "";

// ——— Simulator ———

export type SimRow = Device & { key: string; baseId: string | null; on: boolean; hoursText?: string };

export const initSim = (devs: Device[]): SimRow[] =>
  devs.map((d) => ({ ...d, key: "b-" + d.id, baseId: d.id, on: true }));

export const toDevice = (r: SimRow): Device => {
  const d: Partial<SimRow> = { ...r };
  delete d.key;
  delete d.baseId;
  delete d.on;
  delete d.hoursText;
  return d as Device;
};

/** Has a sim row drifted from its My Home baseline? */
export function isModified(r: SimRow, home: Device[]) {
  if (!r.baseId) return true;
  const b = home.find((x) => x.id === r.baseId);
  if (!b) return true;
  if (!r.on || r.tierOverride !== b.tierOverride || r.quantity !== b.quantity) return true;
  if (String(r.powerSources ?? "") !== String(b.powerSources ?? "")) return true;
  return (["hoursPerDay", "chargesPerDay", "dutyPercent", "workload"] as const).some((f) => r.usage[f] !== b.usage[f]);
}

// ——— Tariff ———

export type Tariff = { value: number; source: string };

/** Mean ₦/kWh of the last 3 logged tokens that have units. */
export function derivedTariff(entries: Entry[]): Tariff | null {
  const t = meterTariff(tokensFromEntries(entries));
  return t && { value: t.value, source: `From your last ${t.count} token${t.count > 1 ? "s" : ""}` };
}

// ——— Add / edit draft ———

export type LabelMethod = Exclude<InputMethod, "preset_only">;
export type FieldKey =
  | "watts" | "outputW" | "volts" | "amps" | "mAh" | "wh" | "nominalVolts" | "batteryLifeHours"
  | "ratedW" | "hp" | "btu" | "kwhPerYear" | "hours";

export type Draft = {
  mode: "add" | "edit";
  target: "home" | "sim";
  fromPicker: boolean;
  isCustom: boolean;
  step: "label" | "usage";
  adv: boolean;
  why: boolean;
  id: string;
  presetId: string | null;
  name: string;
  category: CategoryId;
  icon: string;
  quantity: number;
  usage: DeviceUsage;
  tierOverride?: TierKey;
  powerSources?: Device["powerSources"];
  createdAt: string;
  /** The label fields being shown (fridges can switch to watts, ACs to HP/BTU). */
  method: LabelMethod;
  /** "I don't know — use typical". */
  typical: boolean;
  /** Raw text of every numeric input, so partial input like "1." survives. */
  f: Partial<Record<FieldKey, string>>;
  ampsIsMilli: boolean;
  battUnit: "mAh" | "Wh";
  hpMode: "rated" | "hp" | "btu";
  hpKind: "ac_cooling" | "motor";
};

export const presetOfDraft = (d: Pick<Draft, "presetId">) => (d.presetId ? PRESET_BY[d.presetId] : undefined);

const str = (n: number | undefined) => (n == null ? undefined : String(n));

export function newDraft(p: Preset, target: "home" | "sim"): Draft {
  const dev = fromPreset(p);
  return {
    ...draftFrom(dev, "add", target),
    fromPicker: true,
    typical: false,
  };
}

export function newCustomDraft(name: string, target: "home" | "sim"): Draft {
  return {
    mode: "add", target, fromPicker: true, isCustom: true, step: "label", adv: false, why: false,
    id: uid(), presetId: null, name, category: "other", icon: CAT_ICON.other, quantity: 1,
    usage: { profile: "steady", hoursPerDay: 4, dutyPercent: 50, chargesPerDay: 1 },
    createdAt: now(), method: "watts", typical: false, f: { hours: "4" },
    ampsIsMilli: false, battUnit: "mAh", hpMode: "rated", hpKind: "ac_cooling",
  };
}

/** Open an existing device for editing. */
export function draftFrom(d: Device, mode: "add" | "edit" = "edit", target: "home" | "sim" = "home"): Draft {
  const p = d.presetId ? PRESET_BY[d.presetId] : undefined;
  const r = d.rating;
  const method: LabelMethod = r.method === "preset_only" ? (p?.method ?? "watts") : r.method;
  const hpMode = r.method === "hp_btu" ? (r.watts ? "rated" : r.btu ? "btu" : r.hp ? "hp" : "rated") : "rated";
  return {
    mode, target, fromPicker: false, isCustom: !p, step: "label", adv: false, why: false,
    id: d.id, presetId: d.presetId, name: d.name, category: d.category, icon: d.icon, quantity: d.quantity,
    usage: { ...d.usage }, tierOverride: d.tierOverride, powerSources: d.powerSources, createdAt: d.createdAt,
    method, typical: r.method === "preset_only",
    f: {
      watts: r.method === "watts" && !r.wattsIsOutput ? str(r.watts) : undefined,
      outputW: r.method === "watts" && r.wattsIsOutput ? str(r.watts) : undefined,
      volts: str(r.volts),
      amps: str(r.amps),
      mAh: str(r.mAh),
      wh: str(r.wh),
      nominalVolts: str(r.nominalVolts),
      batteryLifeHours: str(r.batteryLifeHours),
      ratedW: r.method === "hp_btu" ? str(r.watts) : undefined,
      hp: str(r.hp),
      btu: str(r.btu),
      kwhPerYear: str(r.kwhPerYear),
      hours: str(d.usage.hoursPerDay ?? 0),
    },
    ampsIsMilli: !!r.ampsIsMilli,
    battUnit: r.wh ? "Wh" : "mAh",
    hpMode,
    hpKind: r.hpKind ?? p?.label.hpKind ?? "ac_cooling",
  };
}

const val = (d: Draft, k: FieldKey) => {
  const n = num(d.f[k]);
  return n > 0 ? n : undefined;
};

/** Did the user type a usable label value for the current method? */
export function hasLabelValue(d: Draft): boolean {
  const p = presetOfDraft(d);
  switch (d.method) {
    case "watts":
      return !!(val(d, "watts") || (p?.kind === "microwave" && val(d, "outputW")));
    case "volts_amps":
      return !!(val(d, "volts") && val(d, "amps"));
    case "battery":
      return !!(d.battUnit === "Wh" ? val(d, "wh") : val(d, "mAh")) ||
        (p?.kind === "mifi" && !!(val(d, "batteryLifeHours") || (val(d, "volts") && val(d, "amps"))));
    case "hp_btu":
      return !!val(d, d.hpMode === "rated" ? "ratedW" : d.hpMode);
    case "kwh_year":
      return !!val(d, "kwhPerYear");
  }
}

export function draftRating(d: Draft): DeviceRating {
  const p = presetOfDraft(d);
  if (p && (d.typical || !hasLabelValue(d))) return { method: "preset_only" };
  switch (d.method) {
    case "watts": {
      const input = val(d, "watts");
      if (p?.kind === "microwave" && !input) return { method: "watts", watts: val(d, "outputW"), wattsIsOutput: true };
      return { method: "watts", watts: input };
    }
    case "volts_amps":
      return { method: "volts_amps", volts: val(d, "volts"), amps: val(d, "amps"), ampsIsMilli: d.ampsIsMilli || undefined };
    case "battery": {
      const batt = d.battUnit === "Wh" ? { wh: val(d, "wh") } : { mAh: val(d, "mAh") ?? (p?.kind === "mifi" && !val(d, "wh") ? p.label.mAh : undefined) };
      return {
        method: "battery",
        ...batt,
        nominalVolts: val(d, "nominalVolts"),
        batteryLifeHours: d.usage.profile === "always_on_battery" ? val(d, "batteryLifeHours") : undefined,
        ...(d.usage.profile === "always_on_battery" && val(d, "volts") && val(d, "amps")
          ? { volts: val(d, "volts"), amps: val(d, "amps"), ampsIsMilli: d.ampsIsMilli || undefined }
          : {}),
      };
    }
    case "hp_btu":
      return {
        method: "hp_btu",
        hpKind: d.hpKind,
        ...(d.hpMode === "rated" ? { watts: val(d, "ratedW") } : d.hpMode === "hp" ? { hp: val(d, "hp") } : { btu: val(d, "btu") }),
      };
    case "kwh_year":
      return { method: "kwh_year", kwhPerYear: val(d, "kwhPerYear") };
  }
}

export function draftToDevice(d: Draft): Device {
  const hours = Math.min(24, Math.max(0, num(d.f.hours)));
  const usage: DeviceUsage = { ...d.usage };
  if (usage.profile === "steady" || usage.profile === "cycling") usage.hoursPerDay = hours;
  return {
    id: d.id,
    presetId: d.presetId,
    name: d.name.trim() || (d.isCustom ? "Custom device" : (presetOfDraft(d)?.name ?? "Device")),
    category: d.category,
    icon: d.icon,
    quantity: Math.min(LIMITS.quantity[1], Math.max(1, Math.round(d.quantity))),
    rating: draftRating(d),
    usage,
    tierOverride: d.tierOverride,
    ...(d.powerSources ? { powerSources: d.powerSources } : {}),
    createdAt: d.createdAt,
    updatedAt: now(),
  };
}

const FIELD_LIMIT: Partial<Record<FieldKey, LimitKey>> = {
  watts: "watts", outputW: "watts", ratedW: "watts", volts: "volts", mAh: "mAh", wh: "wh",
  nominalVolts: "nominalVolts", batteryLifeHours: "batteryLifeHours", hp: "hp", btu: "btu", kwhPerYear: "kwhPerYear",
};

/** Hard validation (§9) for the fields currently on screen. */
export function fieldErrors(d: Draft): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  if (d.typical) return out;
  for (const [k, raw] of Object.entries(d.f) as [FieldKey, string | undefined][]) {
    if (!raw?.trim() || k === "hours") continue;
    const v = num(raw);
    const key: LimitKey | undefined = k === "amps" ? (d.ampsIsMilli ? "mA" : "amps") : FIELD_LIMIT[k];
    if (key && outOfRange(key, v)) {
      const [lo, hi] = LIMITS[key];
      out[k] = `Enter ${lo.toLocaleString("en-NG")}–${hi.toLocaleString("en-NG")}`;
    }
  }
  return out;
}

/** Field keys actually used by the current method, so stale values in hidden fields don't block saving. */
export function visibleFields(d: Draft): FieldKey[] {
  const p = presetOfDraft(d);
  switch (d.method) {
    case "watts":
      return p?.kind === "microwave" ? ["watts", "outputW"] : ["watts"];
    case "volts_amps":
      return ["volts", "amps"];
    case "battery":
      return [
        d.battUnit === "Wh" ? "wh" : "mAh",
        "nominalVolts",
        ...(d.usage.profile === "always_on_battery" ? (["batteryLifeHours", "volts", "amps"] as FieldKey[]) : []),
      ];
    case "hp_btu":
      return [d.hpMode === "rated" ? "ratedW" : d.hpMode];
    case "kwh_year":
      return ["kwhPerYear"];
  }
}

export function canSaveDraft(d: Draft): boolean {
  const errs = fieldErrors(d);
  if (visibleFields(d).some((k) => errs[k])) return false;
  if (d.isCustom && !hasLabelValue(d)) return false;
  return resolveDraw(draftToDevice(d)).typical > 0;
}

/** Placeholder text from the preset's typical label values. */
export function placeholder(d: Draft, k: FieldKey): string {
  const p = presetOfDraft(d);
  if (!p) return k === "nominalVolts" ? "3.7" : "";
  const l = p.label;
  const v: Partial<Record<FieldKey, number | undefined>> = {
    watts: p.method === "watts" ? l.watts : p.fallback?.watts[1],
    outputW: l.watts ? Math.round(l.watts / MICROWAVE_OUTPUT_TO_INPUT[1]) : undefined,
    volts: l.volts, amps: l.amps, mAh: l.mAh, wh: l.wh ?? (l.mAh ? Math.round((l.mAh * DEFAULT_NOMINAL_V[p.nominal ?? "liion_generic"]) / 100) / 10 : undefined),
    nominalVolts: DEFAULT_NOMINAL_V[p.nominal ?? "liion_generic"],
    hp: l.hp ?? (l.btu ? Math.round((l.btu / BTU_PER_HP_AC) * 10) / 10 : undefined),
    btu: l.btu, kwhPerYear: l.kwhPerYear,
    ratedW: l.btu || l.hp ? Math.round(resolveDraw(fromPreset(p)).typical) : undefined,
  };
  const n = v[k];
  return n == null ? "" : n.toLocaleString("en-NG");
}

/** Short typical figure for the picker list. */
export function presetFigure(p: Preset): string {
  if (p.method === "battery") return p.label.wh ? `~${p.label.wh}Wh battery` : `~${p.label.mAh!.toLocaleString("en-NG")}mAh`;
  if (p.method === "kwh_year") return `~${p.label.kwhPerYear} kWh/yr`;
  const w = resolveDraw(fromPreset(p)).typical;
  return `~${fmtDraw(w)}W${p.profile === "cycling" ? " · cycles on/off" : ""}`;
}

export { adapterMaxW };
export type { InputMethod, UsageProfile };

// ——— Migration from the v1 device shape ———

type LegacyDevice = {
  id: string;
  presetId: string | null;
  name: string;
  cat: CategoryId;
  icon: string;
  type: "steady" | "cycling" | "charging";
  tiers: [number, number, number] | null;
  tier: "low" | "typical" | "high" | "custom";
  custom: number | null;
  hours: number;
  charges: number;
  duty: number;
  qty: number;
};

/** v1 preset names that changed; devices still carrying them get the new name. */
const LEGACY_NAMES: Record<string, string> = {
  router: "Router / MiFi",
  laptop: "Laptop (charging)",
  fridge: "Fridge (small/medium)",
  "ac-15hp-inv": "AC 1.5HP (inverter)",
  starlink: "Starlink / satellite internet",
};

export const isLegacyDevice = (d: unknown): d is LegacyDevice =>
  !!d && typeof d === "object" && !("rating" in d) && "type" in d;

export function migrateDevice(o: LegacyDevice): Device {
  // v1 "Router / MiFi" → "Router (no battery)" and "Laptop (charging)" → "Laptop — charge then unplug" keep their ids.
  const presetId = o.presetId && PRESET_BY[o.presetId] ? o.presetId : null;
  const p = presetId ? PRESET_BY[presetId] : undefined;
  const charging = o.type === "charging";
  const customVal = o.tier === "custom" || !o.tiers ? o.custom : null;
  const rating: DeviceRating = customVal
    ? charging
      ? { method: "battery", wh: customVal }
      : { method: "watts", watts: customVal, factor: 1 }
    : { method: "preset_only" };
  const profile: UsageProfile = p && !customVal ? p.profile : o.type === "charging" ? "charges" : o.type;
  const usage: DeviceUsage = p && !customVal ? presetUsage(p) : { profile };
  if (profile === "steady" || profile === "cycling") usage.hoursPerDay = o.hours;
  if (profile === "cycling") usage.dutyPercent = (o.type === "cycling" && o.duty) || p?.duty || 100;
  if (profile === "charges") usage.chargesPerDay = o.charges;
  const t = new Date().toISOString();
  return {
    id: o.id,
    presetId,
    name: p && LEGACY_NAMES[p.id] === o.name ? p.name : o.name,
    category: o.cat,
    icon: o.icon,
    quantity: Math.min(LIMITS.quantity[1], Math.max(1, o.qty || 1)),
    rating,
    usage,
    tierOverride: o.tier === "low" || o.tier === "high" ? o.tier : undefined,
    createdAt: t,
    updatedAt: t,
  };
}

export const normaliseDevice = (d: unknown): Device => (isLegacyDevice(d) ? migrateDevice(d) : (d as Device));
