// Engine shapes (what the screens use) ↔ Firestore docs and the user doc. Pure functions only; the web app
// and the API (aggregates) share them.
import type { Device } from "./energy.ts";
import { normaliseDevice } from "./appliances.ts";
import type { FuelPurchase, GeneratorProfile } from "./generator.ts";
import { localNoon, type MeterReading, type MeterState } from "./meter.ts";
import { normaliseSolar, type SolarSettings } from "./solar.ts";
import { DEFAULT_SETTINGS, unitPrice, type Entry, type Settings } from "./spend.ts";
import type {
  DeviceDoc, FuelPurchaseDoc, GeneratorDoc, MeterReadingDoc, TokenLoadDoc, UserDoc, UserDocPatch,
} from "@calgy/shared";

/** A doc as the screens produce it: no data-layer metadata yet. */
export type Bare<T> = Omit<T, "clientId" | "updatedAt">;

// ——— Spend log: tokens ———

export const entryToToken = (e: Entry): Bare<TokenLoadDoc> => ({
  id: e.id,
  createdAt: e.created_at,
  amountNaira: e.amount_naira,
  unitsReceived: e.quantity && e.quantity > 0 ? e.quantity : null,
  unitPrice: e.unit_price ?? unitPrice(e.amount_naira, e.quantity),
  date: e.date,
  loadedAt: e.loaded_at ?? localNoon(e.date),
  beforeReadingId: e.before_reading_id ?? null,
  note: e.note,
});

export const tokenToEntry = (d: TokenLoadDoc): Entry => ({
  id: d.id,
  type: "token",
  amount_naira: d.amountNaira,
  quantity: d.unitsReceived,
  unit_price: d.unitPrice ?? unitPrice(d.amountNaira, d.unitsReceived),
  date: d.date,
  note: d.note,
  created_at: d.createdAt ?? d.loadedAt,
  loaded_at: d.loadedAt,
  ...(d.beforeReadingId ? { before_reading_id: d.beforeReadingId } : {}),
});

// ——— Spend log: fuel (one doc = the log entry + its generator purchase, which share an id) ———

export function fuelDocs(entries: Entry[], purchases: FuelPurchase[]): Bare<FuelPurchaseDoc>[] {
  const byId = new Map(purchases.map((p) => [p.id, p]));
  return entries
    .filter((e) => e.type === "fuel")
    .map((e) => {
      const p = byId.get(e.id);
      const litres = e.quantity && e.quantity > 0 ? e.quantity : (p?.litres ?? null);
      return {
        id: e.id,
        createdAt: e.created_at,
        amountNaira: e.amount_naira,
        litres,
        unitPrice: e.unit_price ?? unitPrice(e.amount_naira, litres),
        purchasedAt: e.date,
        note: e.note,
        generatorId: p?.generatorId ?? null,
        hoursRun: p?.hoursRun ?? null,
        source: p?.source ?? null,
      };
    });
}

export const fuelToEntry = (d: FuelPurchaseDoc): Entry => ({
  id: d.id,
  type: "fuel",
  amount_naira: d.amountNaira,
  quantity: d.litres,
  unit_price: d.unitPrice ?? unitPrice(d.amountNaira, d.litres),
  date: d.purchasedAt,
  note: d.note,
  created_at: d.createdAt ?? `${d.purchasedAt}T12:00:00.000Z`,
});

/** Only purchases linked to the generator (with litres) feed the gen numbers. */
export const fuelToPurchase = (d: FuelPurchaseDoc): FuelPurchase | null =>
  d.generatorId && d.litres
    ? {
        id: d.id,
        generatorId: d.generatorId,
        amountNaira: d.amountNaira,
        litres: d.litres,
        hoursRun: d.hoursRun,
        purchasedAt: d.purchasedAt,
        source: d.source ?? "log",
        createdAt: d.createdAt ?? `${d.purchasedAt}T12:00:00.000Z`,
      }
    : null;

// ——— Readings, devices, generator ———

export const readingToDoc = (r: MeterReading): Bare<MeterReadingDoc> => ({ ...r });

export const docToReading = (d: MeterReadingDoc): MeterReading => ({
  id: d.id,
  unitsLeft: d.unitsLeft,
  takenAt: d.takenAt,
  context: d.context,
  ...(d.meterDaysLeft != null ? { meterDaysLeft: d.meterDaysLeft } : {}),
  ...(d.meterDailyAvgKwh != null ? { meterDailyAvgKwh: d.meterDailyAvgKwh } : {}),
});

export const deviceToDoc = (d: Device, pos: number): Bare<DeviceDoc> => ({ ...(d as unknown as DeviceDoc), pos });

export function docToDevice(d: DeviceDoc): Device {
  const raw: Record<string, unknown> = { ...d };
  delete raw.pos;
  delete raw.clientId;
  return normaliseDevice(raw);
}

export const generatorToDoc = (g: GeneratorProfile): Bare<GeneratorDoc> => ({ ...g });

export function docToGenerator(d: GeneratorDoc): GeneratorProfile {
  const g: GeneratorProfile = {
    id: d.id, sizeSource: d.sizeSource, kwLow: d.kwLow, kwHigh: d.kwHigh, fuelType: d.fuelType,
    createdAt: d.createdAt ?? new Date().toISOString(),
  };
  if (d.typeId) g.typeId = d.typeId;
  if (d.ratingValue != null) g.ratingValue = d.ratingValue;
  if (d.ratingUnit) g.ratingUnit = d.ratingUnit;
  return g;
}

// ——— User doc ———

export const settingsFromDoc = (u: UserDoc): Settings => ({
  ...DEFAULT_SETTINGS,
  onboarded: u.onboarding.completed,
  source: u.onboarding.source,
  fuelWeekly: u.household.fuelWeekly,
  tokenMonthly: u.household.tokenMonthly,
  gridHours: u.gridHours.value ?? DEFAULT_SETTINGS.gridHours,
  gridHoursSource: u.gridHours.source,
  gridHoursRange: u.gridHours.inferredRange,
  calibrate: u.settings.calibrationEnabled,
  lastExport: u.settings.lastExport,
});

export const meterFromDoc = (u: UserDoc): MeterState => ({
  profile: {
    ...(u.meterProfile.meterDailyAvgKwh != null ? { meterDailyAvgKwh: u.meterProfile.meterDailyAvgKwh } : {}),
    ...(u.meterProfile.lifetimeKwh != null ? { lifetimeKwh: u.meterProfile.lifetimeKwh } : {}),
    ...(u.meterProfile.meterStartDate ? { meterStartDate: u.meterProfile.meterStartDate } : {}),
  },
  tokenSkips: u.meterState.tokenSkips,
  reminder: { on: u.settings.reminder.enabled, day: u.settings.reminder.day as MeterState["reminder"]["day"], time: u.settings.reminder.time },
  suggestionKeptAt: u.meterState.suggestionKeptAt,
});

export const solarFromDoc = (u: UserDoc): SolarSettings => normaliseSolar(u.solar as Partial<SolarSettings> | null);

export const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** JSON with sorted keys and undefined dropped, so equal values compare equal. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, x[k]]))
      : x,
  );
}

/** Fields of `next` that differ from `prev`; null when nothing changed. */
function changed<T extends object>(prev: T, next: T): Partial<T> | null {
  const out: Partial<T> = {};
  for (const k of Object.keys(next) as (keyof T)[]) if (!same(prev[k], next[k])) out[k] = next[k];
  return Object.keys(out).length ? out : null;
}

/** Inferred hours are re-sent only when they move by this much (or the range changes). */
export const INFERRED_HOURS_STEP = 0.5;

/** Whether an inferred-hours change is worth a write. */
export function inferredHoursChanged(prev: UserDoc["gridHours"], next: UserDoc["gridHours"]) {
  if (prev.source !== "inferred" || next.source !== "inferred") return !same(prev, next);
  if (!same(prev.inferredRange, next.inferredRange)) return true;
  return Math.abs((prev.value ?? 0) - (next.value ?? 0)) >= INFERRED_HOURS_STEP;
}

/** The user-doc patch that makes the doc match the screens' settings. `skipInferred` leaves inferred hours to their own debounce. */
export function settingsPatch(u: UserDoc, s: Partial<Settings>, opts: { skipInferred?: boolean } = {}): UserDocPatch {
  const p: UserDocPatch = {};
  const onboarding = changed(u.onboarding, { completed: s.onboarded ?? u.onboarding.completed, source: s.source ?? u.onboarding.source });
  if (onboarding) p.onboarding = onboarding;
  const household = changed(u.household, {
    fuelWeekly: s.fuelWeekly ?? u.household.fuelWeekly,
    tokenMonthly: s.tokenMonthly ?? u.household.tokenMonthly,
  });
  if (household) p.household = household;
  const gh: UserDoc["gridHours"] = {
    source: s.gridHoursSource ?? u.gridHours.source,
    value: s.gridHours ?? u.gridHours.value,
    inferredRange: s.gridHoursRange !== undefined ? s.gridHoursRange : u.gridHours.inferredRange,
  };
  const ghChanged = changed(u.gridHours, gh);
  if (ghChanged && !(opts.skipInferred && gh.source === "inferred")) p.gridHours = ghChanged;
  const settings = changed(
    { calibrationEnabled: u.settings.calibrationEnabled, lastExport: u.settings.lastExport },
    { calibrationEnabled: s.calibrate ?? u.settings.calibrationEnabled, lastExport: s.lastExport !== undefined ? s.lastExport : u.settings.lastExport },
  );
  if (settings) p.settings = settings;
  return p;
}

export function meterPatch(u: UserDoc, m: MeterState): UserDocPatch {
  const p: UserDocPatch = {};
  const profile = changed(u.meterProfile, {
    meterDailyAvgKwh: m.profile.meterDailyAvgKwh ?? null,
    lifetimeKwh: m.profile.lifetimeKwh ?? null,
    meterStartDate: m.profile.meterStartDate ?? null,
  });
  if (profile) p.meterProfile = profile;
  const state = changed(u.meterState, { tokenSkips: m.tokenSkips, suggestionKeptAt: m.suggestionKeptAt });
  if (state) p.meterState = state;
  const r = u.settings.reminder;
  const reminder = changed({ enabled: r.enabled, day: r.day, time: r.time }, { enabled: m.reminder.on, day: m.reminder.day, time: m.reminder.time });
  if (reminder) p.settings = { reminder };
  return p;
}

export const isEmptyPatch = (p: UserDocPatch) => Object.keys(p).length === 0;

// ——— Diffs for saves ———

/** Metadata the server owns; never compared. */
const META = ["clientId", "createdAt", "updatedAt"];
const strip = (d: Record<string, unknown>) => {
  const o = { ...d };
  for (const k of META) delete o[k];
  return o;
};

export type DocDiff<T> = { upserts: { doc: T; create: boolean; removedKeys: string[] }[]; deletes: string[] };

/** What to write so the collection goes from `prev` (last known) to `next` (what the screen holds). */
export function diffDocs<T extends { id: string }>(prev: Map<string, T>, next: T[]): DocDiff<T> {
  const upserts: DocDiff<T>["upserts"] = [];
  const seen = new Set<string>();
  for (const d of next) {
    seen.add(d.id);
    const p = prev.get(d.id);
    if (!p) {
      upserts.push({ doc: d, create: true, removedKeys: [] });
      continue;
    }
    const a = strip(p as Record<string, unknown>);
    const b = strip(d as Record<string, unknown>);
    if (same(a, b)) continue;
    const removedKeys = Object.keys(a).filter((k) => a[k] !== undefined && b[k] === undefined);
    upserts.push({ doc: d, create: false, removedKeys });
  }
  return { upserts, deletes: [...prev.keys()].filter((id) => !seen.has(id)) };
}
