// Calgy device energy engine. Pure functions only: label values + usage → W / Wh ranges.
// Used by My Home, the add-device flow, the simulator, solar sizing and meter calibration.
// Imports carry .ts extensions so `node --test` can run the unit tests without a build step.

import {
  AC_COP, ADAPTER_TYPICAL_FACTOR, BTU_PER_HP_AC, CHARGE_EFFICIENCY, DEFAULT_NOMINAL_V, DEFAULT_OUTAGES_PER_DAY,
  FACTOR_SPREAD, LAPTOP_WORKLOAD_W, MAINS_VOLTS, MICROWAVE_OUTPUT_TO_INPUT, MIFI_MAX_W, MOTOR_EFFICIENCY,
  RECOVERY_FACTOR, W_PER_BTU_H, W_PER_HP_MOTOR, WORKLOAD_SCALE, type Triple,
} from "./energy-constants.ts";
import {
  PRESET_BY, type CategoryId, type InputMethod, type Preset, type PresetLabel, type UsageProfile, type Workload,
} from "./presets.ts";

export type TierKey = "low" | "typical" | "high";
export type Range = { low: number; typical: number; high: number };

export interface DeviceRating {
  method: InputMethod;
  watts?: number; // label W; for hp_btu this is "rated power input"
  wattsIsOutput?: boolean; // microwave: only the output (cooking) W was given
  factor?: number; // overrides the preset's typical-use factor (migrated custom watts use 1)
  volts?: number;
  amps?: number;
  ampsIsMilli?: boolean;
  mAh?: number;
  nominalVolts?: number;
  wh?: number;
  batteryLifeHours?: number;
  hp?: number;
  btu?: number;
  hpKind?: "ac_cooling" | "motor";
  kwhPerYear?: number;
}

export interface DeviceUsage {
  profile: UsageProfile;
  hoursPerDay?: number;
  dutyPercent?: number;
  chargesPerDay?: number;
  workload?: Workload;
  wireless?: boolean;
  inverter?: boolean;
}

export interface Device {
  id: string;
  presetId: string | null;
  name: string;
  category: CategoryId;
  icon: string;
  quantity: number;
  rating: DeviceRating;
  usage: DeviceUsage;
  tierOverride?: TierKey;
  /** Hybrid homes only: what it runs on. Unset = the household default (see calibration.ts `sourcesOf`). */
  powerSources?: ("grid" | "gen")[];
  createdAt: string;
  updatedAt: string;
}

const map3 = (f: (i: 0 | 1 | 2) => number): Triple => [f(0), f(1), f(2)];
const same = (v: number): Triple => [v, v, v];
const toRange = (t: Triple): Range => ({ low: t[0], typical: t[1], high: t[2] });
const pos = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export const ZERO: Range = { low: 0, typical: 0, high: 0 };
export const addRange = (a: Range, b: Range): Range => ({
  low: a.low + b.low, typical: a.typical + b.typical, high: a.high + b.high,
});
export const scaleRange = (r: Range, k: number): Range => ({ low: r.low * k, typical: r.typical * k, high: r.high * k });

const presetOf = (d: Device): Preset | undefined => (d.presetId ? PRESET_BY[d.presetId] : undefined);

/** "Use typical" falls back to the preset's own method and typical label values. */
function effective(d: Device): { method: Exclude<InputMethod, "preset_only">; r: DeviceRating & PresetLabel; typical: boolean; p?: Preset } {
  const p = presetOf(d);
  if (d.rating.method === "preset_only" && p) {
    // Keep extras the user entered (e.g. MiFi battery life), but use the preset's label values.
    return { method: p.method, r: { ...d.rating, ...p.label, method: p.method }, typical: true, p };
  }
  const method = d.rating.method === "preset_only" ? "watts" : d.rating.method;
  return { method, r: d.rating, typical: false, p };
}

export const ampsOf = (r: DeviceRating) => (pos(r.amps) ? (r.ampsIsMilli ? r.amps / 1000 : r.amps) : 0);

/** Adapter / charger maximum. Mains-side ratings (≥100V) use mains volts. */
export const adapterMaxW = (r: DeviceRating) => {
  const a = ampsOf(r);
  if (!pos(r.volts) || !a) return 0;
  return (r.volts >= 100 ? MAINS_VOLTS : r.volts) * a;
};

export const nominalFor = (r: DeviceRating, p?: Preset) =>
  pos(r.nominalVolts) ? r.nominalVolts : DEFAULT_NOMINAL_V[p?.nominal ?? "liion_generic"];

/** Battery energy (Wh) from the label: Wh wins, else mAh × nominal V. */
export const batteryWhOf = (r: DeviceRating, p?: Preset) =>
  pos(r.wh) ? r.wh : pos(r.mAh) ? (r.mAh * nominalFor(r, p)) / 1000 : 0;

const factorTriple = (f: number, spread: boolean): Triple =>
  !spread || f >= 1 ? same(f) : map3((i) => Math.min(1, f * FACTOR_SPREAD[i]));

/** Draw while running (W) from a watts label. Preset defaults use the preset range with a point factor. */
function fromWatts(r: DeviceRating, p: Preset | undefined, typical: boolean): Triple {
  const base = typical && p?.range ? p.range : same(r.watts ?? 0);
  const out = p?.kind === "microwave" && r.wattsIsOutput ? map3((i) => base[i] * MICROWAVE_OUTPUT_TO_INPUT[i]) : base;
  const f = r.factor ?? p?.factor ?? 1;
  const ft = factorTriple(f, !typical);
  return map3((i) => out[i] * ft[i]);
}

/** AC: cooling capacity ÷ COP, unless the label's rated power input is known. Motor: HP × 746 ÷ efficiency. */
function fromHpBtu(r: DeviceRating & PresetLabel): Triple {
  if (pos(r.watts)) return same(r.watts);
  if (r.hpKind === "motor") return map3((i) => ((r.hp ?? 0) * W_PER_HP_MOTOR) / MOTOR_EFFICIENCY[i]);
  const btu = pos(r.btu) ? r.btu : (r.hp ?? 0) * BTU_PER_HP_AC;
  return map3((i) => (btu * W_PER_BTU_H) / AC_COP[i]);
}

/** Battery Wh (not wall energy). */
const batteryTriple = (r: DeviceRating, p: Preset | undefined, typical: boolean): Triple =>
  typical && p?.range && p.method === "battery" ? p.range : same(batteryWhOf(r, p));

const efficiency = (d: Device): Triple => (d.usage.wireless ? CHARGE_EFFICIENCY.wireless : CHARGE_EFFICIENCY.wired);

/** Is this device's energy taken from an energy label (duty already included)? */
export const isKwhBased = (d: Device) => effective(d).method === "kwh_year";

/** Base draw for the effective method, before profile-specific rules. */
function baseDraw(d: Device): Triple {
  const { method, r, typical, p } = effective(d);
  switch (method) {
    case "watts":
      return fromWatts(r, p, typical);
    case "volts_amps": {
      const max = adapterMaxW(r);
      return map3((i) => max * ADAPTER_TYPICAL_FACTOR[i]);
    }
    case "battery":
      return batteryTriple(r, p, typical);
    case "hp_btu":
      return fromHpBtu(r);
    case "kwh_year": {
      const k = typical && p?.range ? p.range : same(r.kwhPerYear ?? 0);
      return map3((i) => (k[i] * 1000) / 365 / 24); // average W over the day
    }
  }
}

/** always_on_battery: average device draw (W). */
function deviceWatts(d: Device): Triple {
  const { r, p } = effective(d);
  const wh = batteryTriple(r, p, false);
  if (pos(d.rating.batteryLifeHours) && wh[1] > 0) return map3((i) => wh[i] / d.rating.batteryLifeHours!);
  const max = adapterMaxW(d.rating);
  if (max > 0) return map3((i) => Math.min(MIFI_MAX_W, max * ADAPTER_TYPICAL_FACTOR[i]));
  return p?.deviceW ?? [1.5, 2.5, 5];
}

function pin(t: Triple, tier?: TierKey): Range {
  if (!tier) return toRange(t);
  return toRange(same(t[tier === "low" ? 0 : tier === "typical" ? 1 : 2]));
}

function drawTriple(d: Device): Triple {
  const p = presetOf(d);
  const prof = d.usage.profile;

  if (p?.kind === "laptop" && prof === "steady") {
    const w = LAPTOP_WORKLOAD_W[d.usage.workload ?? "moderate"] as Triple;
    const cap = d.rating.method === "volts_amps" ? adapterMaxW(d.rating) : 0;
    return cap > 0 ? map3((i) => Math.min(w[i], cap)) : w;
  }
  if (prof === "charges") {
    const eff = efficiency(d);
    return map3((i) => baseDraw(d)[i] / eff[i]);
  }
  if (prof === "always_on_battery") return deviceWatts(d);

  const base = baseDraw(d);
  if (p?.kind === "workload") {
    const { r, typical } = effective(d);
    const cap = typical ? (p.range?.[2] ?? Infinity) : (r.watts ?? Infinity);
    const k = WORKLOAD_SCALE[d.usage.workload ?? "moderate"];
    return map3((i) => Math.min(cap, base[i] * k));
  }
  return base;
}

/** W while running (Wh per charge for `charges`, average W for energy-label devices). */
export const resolveDraw = (d: Device): Range => pin(drawTriple(d), d.tierOverride);

const q = (d: Device) => Math.max(0, d.quantity || 0);
const hours = (d: Device) => Math.min(24, Math.max(0, d.usage.hoursPerDay ?? 0));
const dutyOf = (d: Device) => (isKwhBased(d) ? 1 : Math.min(100, Math.max(0, d.usage.dutyPercent ?? 100)) / 100);

function dailyTriple(d: Device, gridHours: number | null, outages: number): Triple {
  const draw = drawTriple(d);
  const G = gridHours == null ? 24 : Math.min(24, Math.max(0, gridHours));
  const n = q(d);
  switch (d.usage.profile) {
    case "steady":
      return map3((i) => draw[i] * Math.min(hours(d), G) * n);
    case "cycling": {
      const h = hours(d);
      const recovery = h >= 24 && G < 24 ? RECOVERY_FACTOR : 1;
      return map3((i) => draw[i] * Math.min(h, G) * dutyOf(d) * recovery * n);
    }
    case "charges":
      return map3((i) => draw[i] * Math.max(0, d.usage.chargesPerDay ?? 0) * n);
    case "always_on_battery": {
      const eff = efficiency(d);
      const { r, p } = effective(d);
      const wh = batteryTriple(r, p, false);
      return map3((i) => {
        const need = draw[i] * 24;
        const fromGrid = G >= 24 ? need : Math.min(need, draw[i] * G + wh[i] * outages);
        return (fromGrid / eff[i]) * n;
      });
    }
  }
}

/** Daily Wh if light were on all day. */
export const dailyEnergyFullSupply = (d: Device): Range => pin(dailyTriple(d, null, DEFAULT_OUTAGES_PER_DAY), d.tierOverride);

/** Daily Wh on prepaid with `gridHours` of light a day. */
export const dailyEnergyWithSupply = (d: Device, gridHours: number, outagesPerDay = DEFAULT_OUTAGES_PER_DAY): Range =>
  pin(dailyTriple(d, gridHours, outagesPerDay), d.tierOverride);

/** Daily Wh; `gridHours = null` means full supply (e.g. sizing solar for what you'd run). */
export const dailyWh = (d: Device, gridHours: number | null) =>
  gridHours == null ? dailyEnergyFullSupply(d) : dailyEnergyWithSupply(d, gridHours);

export function homeTotals(devices: Device[], gridHours: number | null, days: number, tariff?: number | null) {
  const perDevice = devices.map((d) => {
    const kwh = scaleRange(dailyWh(d, gridHours), days / 1000);
    return { id: d.id, kwh, naira: tariff ? scaleRange(kwh, tariff) : undefined };
  });
  const kwh = perDevice.reduce((a, x) => addRange(a, x.kwh), ZERO);
  return { kwh, naira: tariff ? scaleRange(kwh, tariff) : undefined, perDevice };
}

/** Grid hours that make the typical home total match the meter's daily kWh (0.5h steps), or null if impossible. */
export function inferGridHours(devices: Device[], meterDailyKwh: number): number | null {
  if (!devices.length || !(meterDailyKwh > 0)) return null;
  const at = (g: number) => homeTotals(devices, g, 1).kwh.typical;
  const lo = at(0);
  const hi = at(24);
  if (meterDailyKwh < lo * 0.9 || meterDailyKwh > hi * 1.1) return null;
  let a = 0;
  let b = 24;
  for (let k = 0; k < 30; k++) {
    const m = (a + b) / 2;
    if (at(m) < meterDailyKwh) a = m;
    else b = m;
  }
  return Math.round(((a + b) / 2) * 2) / 2;
}

// ——— Plain-language explanation ("How we worked this out") ———

const r1 = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-NG") : String(Math.round(n * 10) / 10));
const pct = (f: number) => `${Math.round(f * 100)}%`;

export function explain(d: Device, gridHours: number): string[] {
  const { method, r, typical, p } = effective(d);
  const prof = d.usage.profile;
  const draw = drawTriple(d);
  const out: string[] = [];
  const src = typical ? "Typical" : "Label";

  if (p?.kind === "laptop" && prof === "steady") {
    const wl = d.usage.workload ?? "moderate";
    out.push(`A laptop doing ${wl} work uses about ${r1(draw[1])}W while plugged in (${r1(draw[0])}–${r1(draw[2])}W).`);
    const cap = d.rating.method === "volts_amps" ? adapterMaxW(d.rating) : 0;
    if (cap) out.push(`Its charger is rated ${r1(cap)}W max, so it can't draw more than that.`);
  } else if (prof === "charges") {
    const wh = baseDraw(d)[1];
    const eff = efficiency(d)[1];
    const batt = pos(r.wh) || (typical && p?.range) ? `${r1(wh)}Wh` : `${(r.mAh ?? 0).toLocaleString("en-NG")}mAh × ${nominalFor(r, p)}V = ${r1(wh)}Wh`;
    out.push(
      `${src === "Label" ? "Battery" : "Typical battery"}: ${batt}. ${d.usage.wireless ? "Wireless charging" : "Charging"} loses ~${pct(1 - eff)} → ~${r1(draw[1])}Wh from the wall per full charge.`,
    );
  } else if (prof === "always_on_battery") {
    const wh = batteryWhOf(r, p);
    if (pos(d.rating.batteryLifeHours) && wh)
      out.push(`Battery: ${r1(wh)}Wh lasting ~${r1(d.rating.batteryLifeHours)}h → it uses about ${r1(draw[1])}W.`);
    else if (adapterMaxW(d.rating))
      out.push(
        `Adapter: ${r1(d.rating.volts!)}V ⎓ ${r1(ampsOf(d.rating))}A = ${r1(adapterMaxW(d.rating))}W max. Devices like this usually use about ${pct(ADAPTER_TYPICAL_FACTOR[1])} of that → ~${r1(draw[1])}W.`,
      );
    else out.push(`A battery router like this usually uses about ${r1(draw[1])}W.`);
    out.push(`It runs on its battery when light goes and recharges when light comes back.`);
  } else {
    switch (method) {
      case "watts": {
        const f = r.factor ?? p?.factor ?? 1;
        const w = typical && p?.range ? p.range[1] : r.watts ?? 0;
        const mw = p?.kind === "microwave" && r.wattsIsOutput;
        if (mw) out.push(`Label: ${r1(w)}W output (cooking power). Input is usually about ${MICROWAVE_OUTPUT_TO_INPUT[1]}× that → ~${r1(w * MICROWAVE_OUTPUT_TO_INPUT[1])}W.`);
        else out.push(`${src}: ${r1(w)}W.`);
        if (f < 1) out.push(`Devices like this rarely run flat out — about ${pct(f)} of the label on average → ~${r1(draw[1])}W.`);
        if (f > 1) out.push(`Tubes also power a ballast (~${pct(f - 1)} extra) → ~${r1(draw[1])}W.`);
        if (p?.kind === "workload" && (d.usage.workload ?? "moderate") !== "moderate")
          out.push(`Adjusted for ${d.usage.workload} use → ~${r1(draw[1])}W.`);
        break;
      }
      case "volts_amps":
        out.push(
          `${src}: ${r1(r.volts ?? 0)}V ⎓ ${r1(ampsOf(r))}A = ${r1(adapterMaxW(r))}W max. Devices like this usually use about ${pct(ADAPTER_TYPICAL_FACTOR[1])} of that → ~${r1(draw[1])}W.`,
        );
        break;
      case "hp_btu":
        if (pos(r.watts)) out.push(`Label: rated power input ${r1(r.watts)}W.`);
        else if (r.hpKind === "motor")
          out.push(`${src}: ${r1(r.hp ?? 0)}HP × 746 = ${r1((r.hp ?? 0) * W_PER_HP_MOTOR)}W at the shaft. Motors are ~75% efficient → ~${r1(draw[1])}W.`);
        else {
          const btu = pos(r.btu) ? r.btu : (r.hp ?? 0) * BTU_PER_HP_AC;
          out.push(
            `${src}: ${btu.toLocaleString("en-NG")} BTU of cooling ≈ ${r1(btu * W_PER_BTU_H)}W. A typical AC uses 1W of light for every ~${AC_COP[1]}W of cooling → ~${r1(draw[1])}W.`,
          );
        }
        break;
      case "kwh_year": {
        const k = typical && p?.range ? p.range[1] : r.kwhPerYear ?? 0;
        out.push(`${typical ? "Typical energy label" : "Energy label"}: ${r1(k)} kWh/yr ≈ ${r1(k / 365)} units a day if light never went.`);
        break;
      }
      case "battery":
        out.push(`${src}: ${r1(batteryWhOf(r, p))}Wh battery.`);
        break;
    }
    const h = hours(d);
    const eff = Math.min(h, gridHours);
    if (prof === "cycling" && !isKwhBased(d))
      out.push(`It switches on and off — running about ${Math.round(dutyOf(d) * 100)}% of the time it's on.`);
    if (h > gridHours)
      out.push(`You get about ${r1(gridHours)}h of light a day, so it can only run ~${r1(eff)}h of the ${r1(h)}h it's set to.`);
    if (prof === "cycling" && h >= 24 && gridHours < 24)
      out.push(`After light comes back it works ~10% harder to cool down again.`);
  }

  const day = dailyEnergyWithSupply(d, gridHours);
  out.push(`${q(d) > 1 ? `× ${q(d)} → ` : "→ "}about ${r1(day.typical / 1000)} units a day.`);
  return out;
}

// ——— Validation (§9) ———

export const LIMITS = {
  watts: [0.5, 5000],
  volts: [3, 250],
  amps: [0.05, 30],
  mA: [50, 30000],
  mAh: [300, 50000],
  wh: [1, 2000],
  nominalVolts: [1.2, 52],
  batteryLifeHours: [0.5, 72],
  hp: [0.25, 10],
  btu: [5000, 60000],
  kwhPerYear: [50, 2500],
  hoursPerDay: [0, 24],
  dutyPercent: [5, 100],
  chargesPerDay: [0, 10],
  quantity: [1, 50],
} as const;
export type LimitKey = keyof typeof LIMITS;

export const outOfRange = (key: LimitKey, v: number) => v < LIMITS[key][0] || v > LIMITS[key][1];

/** Soft warning when a label value is far outside what's normal for the preset. */
export function unusualLabel(d: Device): boolean {
  const p = presetOf(d);
  if (!p || d.rating.method === "preset_only") return false;
  const r = d.rating;
  const check = (v: number | undefined, t?: Triple) => !!t && pos(v) && (v > t[2] * 2 || v < t[0] / 2);
  switch (r.method) {
    case "watts":
      return check(r.watts, p.method === "watts" ? p.range : p.fallback?.watts);
    case "kwh_year":
      return check(r.kwhPerYear, p.range);
    case "battery": {
      const t = p.range ?? (p.label.mAh ? same(batteryWhOf({ method: "battery", mAh: p.label.mAh }, p)) : undefined);
      return check(batteryWhOf(r, p), t);
    }
    case "hp_btu": {
      const t = fromHpBtu({ ...p.label, method: "hp_btu" });
      return check(fromHpBtu(r)[1], t);
    }
    default:
      return false;
  }
}
