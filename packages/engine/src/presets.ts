// Calgy device catalog. Values approximate; all user-editable.
// `label` holds the typical values printed on the device (they prefill the label step and
// drive "use typical"). `range` is [low, typical, high] in the method's main unit:
// label W (watts), kWh/year (kwh_year) or battery Wh (battery). `factor` is the
// typical-use factor applied to label watts (1 = use as-is).

import type { NominalKind, Triple } from "./energy-constants";

export type InputMethod = "watts" | "volts_amps" | "battery" | "hp_btu" | "kwh_year" | "preset_only";
export type UsageProfile = "steady" | "cycling" | "charges" | "always_on_battery";
export type Workload = "light" | "moderate" | "heavy";
export type CategoryId =
  | "cooling" | "kitchen" | "entertainment" | "lighting" | "laundry" | "water" | "tech" | "personal" | "other";

export const CATEGORIES: { id: CategoryId; label: string; icon: string }[] = [
  { id: "cooling", label: "Cooling", icon: "🌀" },
  { id: "kitchen", label: "Kitchen", icon: "🍲" },
  { id: "entertainment", label: "Entertainment", icon: "📺" },
  { id: "lighting", label: "Lighting", icon: "💡" },
  { id: "laundry", label: "Laundry & Cleaning", icon: "🧺" },
  { id: "water", label: "Water", icon: "💧" },
  { id: "tech", label: "Work & Tech", icon: "💻" },
  { id: "personal", label: "Personal care", icon: "💈" },
  { id: "other", label: "Other", icon: "🔌" },
];

/** Typical label values for a preset (same shape as the stored rating fields). */
export type PresetLabel = {
  watts?: number;
  volts?: number;
  amps?: number;
  mAh?: number;
  wh?: number;
  hp?: number;
  btu?: number;
  hpKind?: "ac_cooling" | "motor";
  kwhPerYear?: number;
};

export type Preset = {
  id: string;
  name: string;
  cat: CategoryId;
  icon: string;
  method: Exclude<InputMethod, "preset_only">;
  label: PresetLabel;
  range?: Triple;
  factor?: number;
  nominal?: NominalKind;
  /** Fridges/freezers without an energy label: label watts × duty. */
  fallback?: { watts: Triple; duty: number };
  /** always_on_battery: device draw (W) when neither battery life nor adapter is known. */
  deviceW?: Triple;
  /** laptop = workload table; workload = desktops/consoles scaled by workload; microwave = input vs output W. */
  kind?: "laptop" | "workload" | "microwave" | "mifi";
  profile: UsageProfile;
  hours?: number;
  duty?: number;
  charges?: number;
  workload?: Workload;
  inverter?: boolean;
  help?: string;
};

const W = (
  id: string, name: string, cat: CategoryId, icon: string,
  range: Triple, factor: number, profile: UsageProfile, hours: number, duty?: number, extra: Partial<Preset> = {},
): Preset => ({ id, name, cat, icon, method: "watts", label: { watts: range[1] }, range, factor, profile, hours, duty, ...extra });

const BATT = (
  id: string, name: string, cat: CategoryId, icon: string, mAh: number, nominal: NominalKind, charges: number,
): Preset => ({ id, name, cat, icon, method: "battery", label: { mAh }, nominal, profile: "charges", charges });

const AC = (id: string, name: string, btu: number, inverter = false): Preset => ({
  id, name, cat: "cooling", icon: "❄️", method: "hp_btu", label: { btu, hpKind: "ac_cooling" },
  profile: "cycling", hours: 6, duty: inverter ? 50 : 70, inverter,
});

const COLD = (id: string, name: string, kwh: Triple, watts: Triple, duty: number): Preset => ({
  id, name, cat: "kitchen", icon: "🧊", method: "kwh_year", label: { kwhPerYear: kwh[1] }, range: kwh,
  fallback: { watts, duty }, profile: "cycling", hours: 24, duty,
});

const ADAPTER = (id: string, name: string, cat: CategoryId, icon: string, hours: number): Preset => ({
  id, name, cat, icon, method: "volts_amps", label: { volts: 12, amps: 1.5 }, profile: "steady", hours,
});

const PUMP = (id: string, name: string, hp: number): Preset => ({
  id, name, cat: "water", icon: "💧", method: "hp_btu", label: { hp, hpKind: "motor" }, profile: "steady", hours: 0.5,
});

export const PRESETS: Preset[] = [
  // Cooling
  W("standing-fan", "Standing fan", "cooling", "🌀", [45, 60, 90], 1, "steady", 8),
  W("ceiling-fan", "Ceiling fan", "cooling", "🌀", [50, 75, 90], 1, "steady", 8),
  W("table-fan", "Table fan", "cooling", "🌀", [20, 35, 60], 1, "steady", 6),
  BATT("recharge-fan", "Rechargeable fan", "cooling", "🔋", 4000, "liion_generic", 1),
  AC("ac-1hp", "AC 1HP (non-inverter)", 9000),
  AC("ac-15hp", "AC 1.5HP (non-inverter)", 12000),
  AC("ac-2hp", "AC 2HP (non-inverter)", 18000),
  AC("ac-15hp-inv", "AC (inverter)", 12000, true),

  // Kitchen
  COLD("fridge", "Fridge (single door)", [200, 300, 450], [80, 100, 150], 45),
  COLD("fridge-freezer", "Fridge-freezer (double door)", [300, 425, 600], [120, 150, 200], 45),
  COLD("chest-freezer", "Chest freezer", [300, 450, 650], [100, 150, 250], 50),
  W("microwave", "Microwave", "kitchen", "♨️", [1000, 1200, 1500], 1, "steady", 0.25, undefined, { kind: "microwave" }),
  W("kettle", "Electric kettle", "kitchen", "☕", [1200, 1800, 2200], 1, "steady", 0.2),
  W("blender", "Blender", "kitchen", "🥤", [300, 450, 700], 0.8, "steady", 0.1),
  W("cooker", "Electric cooker / hotplate", "kitchen", "🍲", [1000, 1500, 2000], 1, "cycling", 1, 70),
  W("rice-cooker", "Rice cooker", "kitchen", "🍚", [500, 600, 800], 1, "cycling", 0.5, 80),
  W("toaster", "Toaster / sandwich maker", "kitchen", "🍞", [700, 850, 1200], 1, "steady", 0.1),

  // Entertainment
  W("tv-32", 'LED TV 32"', "entertainment", "📺", [20, 40, 60], 0.8, "steady", 5),
  W("tv-50", "LED TV 43–55\"", "entertainment", "📺", [60, 90, 120], 0.8, "steady", 5),
  ADAPTER("decoder", "Decoder (DStv/GOtv)", "entertainment", "📡", 5),
  W("sound", "Sound system / home theatre", "entertainment", "🔊", [30, 60, 100], 0.5, "steady", 2),
  W("console", "Game console", "entertainment", "🎮", [100, 150, 200], 0.6, "steady", 2, undefined, {
    kind: "workload", workload: "moderate",
  }),

  // Lighting
  W("led", "LED bulb", "lighting", "💡", [5, 9, 15], 1, "steady", 6),
  W("fluorescent", "Fluorescent tube", "lighting", "💡", [18, 36, 40], 1.1, "steady", 6),
  W("incandescent", "Incandescent bulb", "lighting", "💡", [40, 60, 100], 1, "steady", 6),
  W("security", "Security / outdoor light", "lighting", "🔦", [10, 20, 50], 1, "steady", 12),
  BATT("lamp", "Rechargeable lamp", "lighting", "🏮", 2000, "liion_generic", 1),

  // Laundry & cleaning
  W("iron", "Pressing iron", "laundry", "👔", [1000, 1200, 1800], 1, "cycling", 0.5, 50),
  W("washer", "Washing machine", "laundry", "🧺", [350, 500, 1000], 0.6, "steady", 0.4, undefined, {
    help: "1h, 3 times a week ≈ 0.4h a day",
  }),
  W("vacuum", "Vacuum cleaner", "laundry", "🧹", [800, 1200, 1600], 1, "steady", 0.25),

  // Water
  PUMP("pump-05", "Pumping machine 0.5HP", 0.5),
  PUMP("pump-1", "Pumping machine 1HP", 1),
  W("heater", "Water heater", "water", "🚿", [1500, 2000, 3000], 1, "cycling", 1, 60),

  // Work & tech
  ADAPTER("router", "Router (no battery)", "tech", "📶", 24),
  {
    id: "mifi", name: "Router / MiFi with battery", cat: "tech", icon: "📶", method: "battery",
    label: { mAh: 5000, volts: 12, amps: 2 }, nominal: "mifi", deviceW: [1.5, 2.5, 5], kind: "mifi",
    profile: "always_on_battery",
  },
  {
    id: "laptop-plugged", name: "Laptop — plugged in most of the day", cat: "tech", icon: "💻",
    method: "volts_amps", label: { volts: 19.5, amps: 3.33 }, kind: "laptop", profile: "steady", hours: 10,
    workload: "moderate",
  },
  {
    id: "laptop", name: "Laptop — charge then unplug", cat: "tech", icon: "💻", method: "battery",
    label: { wh: 50 }, range: [40, 50, 90], nominal: "liion_generic", profile: "charges", charges: 1,
  },
  W("desktop", "Desktop PC", "tech", "🖥️", [300, 500, 750], 0.4, "steady", 6, undefined, {
    kind: "workload", workload: "moderate", help: "Use the watts on the power supply (PSU) label.",
  }),
  W("monitor", "Monitor", "tech", "🖥️", [15, 25, 40], 0.8, "steady", 6),
  BATT("phone", "Smartphone", "tech", "📱", 5000, "phone", 1),
  BATT("tablet", "Tablet", "tech", "📱", 8000, "tablet", 0.5),
  BATT("pb-10", "Power bank 10,000mAh", "tech", "🔋", 10000, "powerbank", 0.5),
  BATT("pb-20", "Power bank 20,000mAh", "tech", "🔋", 20000, "powerbank", 0.5),
  W("starlink", "Starlink", "tech", "🛰️", [45, 60, 75], 1, "steady", 24),

  // Personal care
  W("hairdryer", "Hair dryer", "personal", "💨", [1000, 1500, 2000], 1, "steady", 0.2),
  BATT("clipper", "Hair clipper", "personal", "✂️", 2000, "liion_generic", 0.3),
];

export const PRESET_BY = Object.fromEntries(PRESETS.map((p) => [p.id, p])) as Record<string, Preset>;

/** "Start with a typical Lagos flat": [presetId, quantity, usage overrides]. */
export const LAGOS_FLAT: [string, number, { hoursPerDay?: number }?][] = [
  ["standing-fan", 2],
  ["led", 4],
  ["tv-32", 1],
  ["decoder", 1],
  ["fridge-freezer", 1],
  ["router", 1],
  ["phone", 2],
  ["laptop-plugged", 1, { hoursPerDay: 8 }],
  ["iron", 1],
];
